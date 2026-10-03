import { PokerRuleError, type PokerAction } from './actions.js';
import { reduceBettingAction } from './betting.js';
import type { PokerEvent } from './events.js';
import { compareHandRanks, type HandRank } from './hand-ranking.js';
import { assertBettingRoundInvariants } from './invariants.js';
import { assertChipAmount, type ChipAmount } from './money.js';
import { assignHandPositions, type HandPositions } from './positions.js';
import { constructPots } from './pots.js';
import {
  createPreflopBettingRound,
  type HandStartPlayer,
} from './preflop.js';
import {
  settlePotAwards,
  type PotAwardSettlement,
} from './settlement.js';
import {
  determinePotWinners,
  type PotWinnerResult,
  type RankedShowdownPlayer,
} from './showdown.js';
import type { BettingRoundState } from './state.js';
import {
  createNextStreetBettingRound,
  type PokerStreet,
} from './streets.js';
import {
  resolveTerminalFold,
  type TerminalFoldResolution,
} from './terminal-fold.js';

export type HandPhase =
  | 'betting'
  | 'awaiting-next-street'
  | 'awaiting-showdown'
  | 'complete';

export interface CreateHandInput {
  readonly players: readonly HandStartPlayer[];
  readonly buttonSeat: number;
  readonly smallBlind: ChipAmount;
  readonly bigBlind: ChipAmount;
}

export interface FoldHandCompletion {
  readonly type: 'fold';
  readonly settlement: TerminalFoldResolution;
}

export interface ShowdownHandCompletion {
  readonly type: 'showdown';
  readonly rankedPlayers: readonly RankedShowdownPlayer[];
  readonly winners: readonly PotWinnerResult[];
  readonly settlement: PotAwardSettlement;
}

export type HandCompletion = FoldHandCompletion | ShowdownHandCompletion;

export interface HandState {
  readonly phase: HandPhase;
  readonly street: PokerStreet;
  readonly buttonSeat: number;
  readonly smallBlind: ChipAmount;
  readonly bigBlind: ChipAmount;
  readonly positions: HandPositions;
  readonly betting: BettingRoundState;
  readonly completion: HandCompletion | null;
}

export interface HandActionResult {
  readonly state: HandState;
  readonly events: readonly PokerEvent[];
}

const freezeHandState = (state: HandState): HandState => Object.freeze({ ...state });

const samePositions = (left: HandPositions, right: HandPositions): boolean =>
  left.buttonSeat === right.buttonSeat &&
  left.smallBlindSeat === right.smallBlindSeat &&
  left.bigBlindSeat === right.bigBlindSeat &&
  left.preflopFirstSeat === right.preflopFirstSeat &&
  left.postflopFirstSeat === right.postflopFirstSeat;

const nonFoldedCount = (state: BettingRoundState): number =>
  state.players.filter((player) => !player.folded).length;

export const assertHandStateInvariants = (state: HandState): void => {
  if (typeof state !== 'object' || state === null) {
    throw new TypeError('Hand state must be an object');
  }

  assertChipAmount(state.smallBlind);
  assertChipAmount(state.bigBlind);
  if (state.smallBlind === 0n || state.bigBlind === 0n || state.smallBlind >= state.bigBlind) {
    throw new Error('Hand state has invalid blinds');
  }

  assertBettingRoundInvariants(state.betting);
  if (!['preflop', 'flop', 'turn', 'river'].includes(state.street)) {
    throw new Error('Hand state has an unknown street');
  }
  if (!['betting', 'awaiting-next-street', 'awaiting-showdown', 'complete'].includes(state.phase)) {
    throw new Error('Hand state has an unknown phase');
  }
  if (state.betting.minimumBet !== state.bigBlind) {
    throw new Error('Hand betting minimum must match the big blind');
  }

  const expectedPositions = assignHandPositions(
    state.betting.players.map((player) => player.seat),
    state.buttonSeat,
  );
  if (!samePositions(state.positions, expectedPositions)) {
    throw new Error('Hand positions do not match the current participants');
  }

  const contenders = nonFoldedCount(state.betting);
  switch (state.phase) {
    case 'betting':
      if (state.betting.status !== 'active' || state.completion !== null) {
        throw new Error('Betting hand phase has inconsistent state');
      }
      break;
    case 'awaiting-next-street':
      if (
        state.betting.status !== 'complete' ||
        state.street === 'river' ||
        contenders <= 1 ||
        state.completion !== null
      ) {
        throw new Error('Awaiting-next-street hand phase has inconsistent state');
      }
      break;
    case 'awaiting-showdown':
      if (
        state.betting.status !== 'complete' ||
        state.street !== 'river' ||
        contenders <= 1 ||
        state.completion !== null
      ) {
        throw new Error('Awaiting-showdown hand phase has inconsistent state');
      }
      break;
    case 'complete':
      if (state.betting.status !== 'complete' || state.completion === null) {
        throw new Error('Completed hand has inconsistent state');
      }
      if (state.completion.type === 'fold') {
        if (contenders !== 1) throw new Error('Fold completion requires one surviving player');
        if (state.completion.settlement.totalChips !== state.betting.totalChips) {
          throw new Error('Fold completion violates hand CHIP conservation');
        }
      } else {
        if (state.street !== 'river' || contenders <= 1) {
          throw new Error('Showdown completion requires a contested river');
        }
        if (state.completion.settlement.totalChips !== state.betting.totalChips) {
          throw new Error('Showdown completion violates hand CHIP conservation');
        }
      }
      break;
  }
};

const withCompletedBetting = (
  state: Omit<HandState, 'phase' | 'completion'>,
): HandState => {
  if (state.betting.status !== 'complete') {
    const active = freezeHandState({ ...state, phase: 'betting', completion: null });
    assertHandStateInvariants(active);
    return active;
  }

  if (nonFoldedCount(state.betting) === 1) {
    const completion = Object.freeze({
      type: 'fold' as const,
      settlement: resolveTerminalFold(state.betting.players),
    });
    const completed = freezeHandState({
      ...state,
      phase: 'complete',
      completion,
    });
    assertHandStateInvariants(completed);
    return completed;
  }

  const phase: HandPhase =
    state.street === 'river' ? 'awaiting-showdown' : 'awaiting-next-street';
  const waiting = freezeHandState({ ...state, phase, completion: null });
  assertHandStateInvariants(waiting);
  return waiting;
};

export const createHand = (input: CreateHandInput): HandState => {
  if (!Array.isArray(input.players)) throw new TypeError('Hand players must be an array');

  const players = [...input.players].sort((left, right) => left.seat - right.seat);
  const positions = assignHandPositions(
    players.map((player) => player.seat),
    input.buttonSeat,
  );
  const betting = createPreflopBettingRound({
    players,
    buttonSeat: input.buttonSeat,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
  });

  return withCompletedBetting({
    street: 'preflop',
    buttonSeat: input.buttonSeat,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    positions,
    betting,
  });
};

export const reduceHandAction = (
  state: HandState,
  action: PokerAction,
): HandActionResult => {
  assertHandStateInvariants(state);
  if (state.phase === 'complete') throw new PokerRuleError('Hand is complete');
  if (state.phase !== 'betting') {
    throw new PokerRuleError('Hand is not accepting betting actions');
  }

  const result = reduceBettingAction(state.betting, action);
  const nextState = withCompletedBetting({
    street: state.street,
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    positions: state.positions,
    betting: result.state,
  });

  return Object.freeze({ state: nextState, events: result.events });
};

const nextStreet = (street: PokerStreet): Exclude<PokerStreet, 'preflop'> => {
  switch (street) {
    case 'preflop':
      return 'flop';
    case 'flop':
      return 'turn';
    case 'turn':
      return 'river';
    case 'river':
      throw new Error('River has no next betting street');
  }
};

export const advanceHandAfterDeal = (
  state: HandState,
  dealtStreet: Exclude<PokerStreet, 'preflop'>,
): HandState => {
  assertHandStateInvariants(state);
  if (state.phase !== 'awaiting-next-street') {
    throw new Error('Hand is not awaiting a dealer street transition');
  }

  const expectedStreet = nextStreet(state.street);
  if (dealtStreet !== expectedStreet) {
    throw new Error(`Dealer street must advance to ${expectedStreet}`);
  }

  const betting = createNextStreetBettingRound(
    state.betting,
    state.positions.postflopFirstSeat,
  );

  return withCompletedBetting({
    street: expectedStreet,
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    positions: state.positions,
    betting,
  });
};

const freezeRank = (rank: HandRank): HandRank =>
  Object.freeze({ category: rank.category, tiebreak: Object.freeze([...rank.tiebreak]) });

const canonicalizeShowdownRanks = (
  state: HandState,
  rankedPlayers: readonly RankedShowdownPlayer[],
): readonly RankedShowdownPlayer[] => {
  if (!Array.isArray(rankedPlayers)) {
    throw new TypeError('Showdown ranks must be an array');
  }

  const contenders = state.betting.players
    .filter((player) => !player.folded)
    .sort((left, right) => left.seat - right.seat);
  if (rankedPlayers.length !== contenders.length) {
    throw new Error('Showdown requires exactly one rank for every non-folded player');
  }

  const byId = new Map<string, HandRank>();
  for (const entry of rankedPlayers) {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError('Showdown rank entry must be an object');
    }
    if (typeof entry.playerId !== 'string' || entry.playerId.length === 0) {
      throw new TypeError('Showdown player identity must be nonempty');
    }
    if (byId.has(entry.playerId)) {
      throw new Error(`Duplicate showdown rank: ${entry.playerId}`);
    }
    compareHandRanks(entry.rank, entry.rank);
    byId.set(entry.playerId, freezeRank(entry.rank));
  }

  const canonical = contenders.map((player) => {
    const rank = byId.get(player.id);
    if (rank === undefined) {
      throw new Error(`Missing showdown rank for non-folded player: ${player.id}`);
    }
    return Object.freeze({ playerId: player.id, rank });
  });

  if (byId.size !== canonical.length) {
    throw new Error('Showdown ranks include a player who is not eligible to show down');
  }

  return Object.freeze(canonical);
};

export const resolveHandShowdown = (
  state: HandState,
  rankedPlayers: readonly RankedShowdownPlayer[],
): HandState => {
  assertHandStateInvariants(state);
  if (state.phase !== 'awaiting-showdown') {
    throw new Error('Hand is not ready for showdown');
  }

  const canonicalRanks = canonicalizeShowdownRanks(state, rankedPlayers);
  const construction = constructPots(state.betting.players);
  const winners = determinePotWinners(construction.pots, canonicalRanks);
  const settlement = settlePotAwards(
    state.betting.players,
    construction,
    winners,
    state.buttonSeat,
  );
  const completion: ShowdownHandCompletion = Object.freeze({
    type: 'showdown',
    rankedPlayers: canonicalRanks,
    winners,
    settlement,
  });
  const completed = freezeHandState({
    ...state,
    phase: 'complete',
    completion,
  });
  assertHandStateInvariants(completed);
  return completed;
};
