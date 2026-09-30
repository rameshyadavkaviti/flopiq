import { addChips, assertChipAmount, chips, type ChipAmount } from './money.js';
import { assertBettingRoundInvariants } from './invariants.js';

export interface BettingPlayerState {
  readonly id: string;
  readonly seat: number;
  readonly stack: ChipAmount;
  readonly streetCommitted: ChipAmount;
  readonly handCommitted: ChipAmount;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly actedSinceLastFullRaise: boolean;
}

export interface CreateBettingRoundStateInput {
  readonly players: readonly BettingPlayerState[];
  readonly actingSeat: number | null;
  readonly currentBet: ChipAmount;
  readonly minimumBet: ChipAmount;
  readonly minimumRaise: ChipAmount;
  readonly lastFullRaise: ChipAmount;
  readonly actionSequence?: number;
}

export interface BettingRoundState {
  readonly players: readonly BettingPlayerState[];
  readonly actingSeat: number | null;
  readonly currentBet: ChipAmount;
  readonly minimumBet: ChipAmount;
  readonly minimumRaise: ChipAmount;
  readonly lastFullRaise: ChipAmount;
  readonly actionSequence: number;
  readonly status: 'active' | 'complete';
  readonly totalChips: ChipAmount;
}

const assertSeat = (seat: number): void => {
  if (!Number.isInteger(seat) || seat < 0 || seat > 8) {
    throw new RangeError('Seat must be an integer from 0 through 8');
  }
};

const assertActionSequence = (sequence: number): void => {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('Action sequence must be a nonnegative safe integer');
  }
};

const validatePlayer = (player: BettingPlayerState, currentBet: ChipAmount): void => {
  if (typeof player.id !== 'string' || player.id.length === 0) {
    throw new TypeError('Player identity must be a nonempty string');
  }
  assertSeat(player.seat);
  assertChipAmount(player.stack);
  assertChipAmount(player.streetCommitted);
  assertChipAmount(player.handCommitted);
  if (
    typeof player.folded !== 'boolean' ||
    typeof player.allIn !== 'boolean' ||
    typeof player.actedSinceLastFullRaise !== 'boolean'
  ) {
    throw new TypeError('Player decision flags must be boolean values');
  }

  if (player.handCommitted < player.streetCommitted) {
    throw new RangeError('Hand commitment cannot be less than street commitment');
  }
  if (player.streetCommitted > currentBet) {
    throw new RangeError('Street commitment cannot exceed the current bet');
  }
  if (player.allIn !== (player.stack === 0n)) {
    throw new Error('All-in state must match a zero remaining stack');
  }
  if (player.folded && player.allIn) {
    throw new Error('A player cannot be both folded and all-in');
  }
};

export const freezeBettingRoundState = (state: BettingRoundState): BettingRoundState => {
  const players = state.players.map((player) => Object.freeze({ ...player }));
  return Object.freeze({ ...state, players: Object.freeze(players) });
};

export const createBettingRoundState = (
  input: CreateBettingRoundStateInput,
): BettingRoundState => {
  if (input.players.length < 2 || input.players.length > 9) {
    throw new RangeError('A betting round must contain 2 through 9 players');
  }

  assertChipAmount(input.currentBet);
  assertChipAmount(input.minimumBet);
  assertChipAmount(input.minimumRaise);
  assertChipAmount(input.lastFullRaise);
  if (input.minimumBet === 0n || input.minimumRaise === 0n || input.lastFullRaise === 0n) {
    throw new RangeError('Minimum bet and raise values must be positive');
  }
  if (input.minimumRaise !== input.lastFullRaise) {
    throw new Error('Minimum raise must equal the last full raise');
  }

  const actionSequence = input.actionSequence ?? 0;
  assertActionSequence(actionSequence);

  const players = input.players.map((player) => ({ ...player }));
  const seats = new Set<number>();
  const playerIds = new Set<string>();
  let totalChips = chips(0n);

  for (const player of players) {
    validatePlayer(player, input.currentBet);
    if (seats.has(player.seat)) throw new Error(`Duplicate seat: ${player.seat}`);
    if (playerIds.has(player.id)) throw new Error(`Duplicate player identity: ${player.id}`);
    seats.add(player.seat);
    playerIds.add(player.id);
    totalChips = addChips(totalChips, addChips(player.stack, player.handCommitted));
  }

  if (input.currentBet > 0n && !players.some((player) => player.streetCommitted === input.currentBet)) {
    throw new Error('Current bet must match at least one player commitment');
  }

  if (input.actingSeat !== null) {
    assertSeat(input.actingSeat);
    const actor = players.find((player) => player.seat === input.actingSeat);
    if (actor === undefined || actor.folded || actor.allIn) {
      throw new Error('Acting seat must identify a player who can act');
    }
  }

  const state = freezeBettingRoundState({
    players,
    actingSeat: input.actingSeat,
    currentBet: input.currentBet,
    minimumBet: input.minimumBet,
    minimumRaise: input.minimumRaise,
    lastFullRaise: input.lastFullRaise,
    actionSequence,
    status: input.actingSeat === null ? 'complete' : 'active',
    totalChips,
  });
  assertBettingRoundInvariants(state);
  return state;
};
