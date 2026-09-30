import { PokerRuleError, type PokerAction } from './actions.js';
import type { PokerEvent } from './events.js';
import { assertBettingRoundInvariants, isBettingRoundComplete } from './invariants.js';
import { assertChipAmount, type ChipAmount } from './money.js';
import {
  freezeBettingRoundState,
  type BettingPlayerState,
  type BettingRoundState,
} from './state.js';

export interface BettingActionResult {
  readonly state: BettingRoundState;
  readonly events: readonly PokerEvent[];
}

type MutablePlayer = { -readonly [Key in keyof BettingPlayerState]: BettingPlayerState[Key] };

const commitChips = (player: MutablePlayer, amount: ChipAmount): MutablePlayer => {
  assertChipAmount(amount);
  if (amount > player.stack) throw new PokerRuleError('Insufficient stack for action');

  const stack = player.stack - amount;
  return {
    ...player,
    stack,
    streetCommitted: player.streetCommitted + amount,
    handCommitted: player.handCommitted + amount,
    allIn: stack === 0n,
    actedSinceLastFullRaise: true,
  };
};

const replacePlayer = (
  players: readonly MutablePlayer[],
  updated: MutablePlayer,
): MutablePlayer[] => players.map((player) => (player.id === updated.id ? updated : player));

const applyFullRaise = (
  players: readonly MutablePlayer[],
  updatedActor: MutablePlayer,
): MutablePlayer[] =>
  players.map((player) => {
    if (player.id === updatedActor.id) {
      return { ...updatedActor, actedSinceLastFullRaise: true };
    }
    if (player.folded || player.allIn) return player;
    return { ...player, actedSinceLastFullRaise: false };
  });

const nextActorSeat = (
  players: readonly MutablePlayer[],
  afterSeat: number,
): number | null => {
  const seats = players
    .filter((player) => !player.folded && !player.allIn)
    .map((player) => player.seat)
    .sort((left, right) => left - right);
  return seats.find((seat) => seat > afterSeat) ?? seats[0] ?? null;
};

const freezeEvents = (events: readonly PokerEvent[]): readonly PokerEvent[] =>
  Object.freeze(events.map((event) => Object.freeze(event)));

export const reduceBettingAction = (
  state: BettingRoundState,
  action: PokerAction,
): BettingActionResult => {
  assertBettingRoundInvariants(state);
  if (state.status === 'complete') throw new PokerRuleError('Betting round is complete');
  if (state.actionSequence === Number.MAX_SAFE_INTEGER) {
    throw new PokerRuleError('Action sequence cannot be incremented safely');
  }

  const actor = state.players.find((player) => player.seat === state.actingSeat);
  if (actor === undefined || action.playerId !== actor.id) {
    throw new PokerRuleError('Only the current actor may act');
  }

  let players: MutablePlayer[] = state.players.map((player) => ({ ...player }));
  let currentBet = state.currentBet;
  let minimumRaise = state.minimumRaise;
  let lastFullRaise = state.lastFullRaise;
  const events: PokerEvent[] = [];

  const commitActor = (amount: ChipAmount, fullRaise: boolean): MutablePlayer => {
    const mutableActor = players.find((player) => player.id === actor.id);
    if (mutableActor === undefined) throw new Error('Actor disappeared from betting state');
    const updated = commitChips(mutableActor, amount);
    players = fullRaise
      ? applyFullRaise(players, updated)
      : replacePlayer(players, updated);
    return updated;
  };

  switch (action.type) {
    case 'fold': {
      const updated = { ...actor, folded: true, actedSinceLastFullRaise: true };
      players = replacePlayer(players, updated);
      events.push({ type: 'PLAYER_FOLDED', playerId: actor.id, seat: actor.seat });
      break;
    }

    case 'check': {
      if (actor.streetCommitted !== currentBet) {
        throw new PokerRuleError('Player cannot check while facing a bet');
      }
      players = replacePlayer(players, { ...actor, actedSinceLastFullRaise: true });
      events.push({ type: 'PLAYER_CHECKED', playerId: actor.id, seat: actor.seat });
      break;
    }

    case 'call': {
      const required = currentBet - actor.streetCommitted;
      if (required === 0n) throw new PokerRuleError('There is nothing to call');
      const amount = required < actor.stack ? required : actor.stack;
      const updated = commitActor(amount, false);
      events.push({
        type: 'PLAYER_CALLED',
        playerId: actor.id,
        seat: actor.seat,
        amount,
        toAmount: updated.streetCommitted,
      });
      if (updated.allIn) {
        events.push({
          type: 'PLAYER_ALL_IN',
          playerId: actor.id,
          seat: actor.seat,
          kind: 'call',
          toAmount: updated.streetCommitted,
        });
      }
      break;
    }

    case 'bet': {
      assertChipAmount(action.amount);
      if (currentBet !== 0n) throw new PokerRuleError('Cannot bet after betting has opened; use raise');
      if (action.amount > actor.stack) throw new PokerRuleError('Insufficient stack for bet');
      if (action.amount < state.minimumBet) throw new PokerRuleError('Bet is below the minimum bet');

      const updated = commitActor(action.amount, true);
      currentBet = updated.streetCommitted;
      minimumRaise = action.amount;
      lastFullRaise = action.amount;
      events.push({ type: 'PLAYER_BET', playerId: actor.id, seat: actor.seat, amount: action.amount });
      if (updated.allIn) {
        events.push({
          type: 'PLAYER_ALL_IN',
          playerId: actor.id,
          seat: actor.seat,
          kind: 'bet',
          toAmount: updated.streetCommitted,
        });
      }
      break;
    }

    case 'raise': {
      assertChipAmount(action.to);
      if (currentBet === 0n) throw new PokerRuleError('Cannot raise before betting has opened');
      if (actor.actedSinceLastFullRaise) {
        throw new PokerRuleError('Action was not reopened by a full raise');
      }
      if (action.to <= currentBet) throw new PokerRuleError('Raise-to amount must exceed the current bet');
      const raiseSize = action.to - currentBet;
      if (raiseSize < minimumRaise) throw new PokerRuleError('Raise is below the minimum raise');
      const amount = action.to - actor.streetCommitted;
      if (amount > actor.stack) throw new PokerRuleError('Insufficient stack for raise');

      const updated = commitActor(amount, true);
      currentBet = action.to;
      minimumRaise = raiseSize;
      lastFullRaise = raiseSize;
      events.push({
        type: 'PLAYER_RAISED',
        playerId: actor.id,
        seat: actor.seat,
        amount,
        toAmount: action.to,
        raiseSize,
        fullRaise: true,
      });
      if (updated.allIn) {
        events.push({
          type: 'PLAYER_ALL_IN',
          playerId: actor.id,
          seat: actor.seat,
          kind: 'raise',
          toAmount: action.to,
        });
      }
      break;
    }

    case 'all-in': {
      const toAmount = actor.streetCommitted + actor.stack;

      if (toAmount <= currentBet) {
        const updated = commitActor(actor.stack, false);
        events.push({
          type: 'PLAYER_CALLED',
          playerId: actor.id,
          seat: actor.seat,
          amount: actor.stack,
          toAmount: updated.streetCommitted,
        });
        events.push({
          type: 'PLAYER_ALL_IN',
          playerId: actor.id,
          seat: actor.seat,
          kind: 'call',
          toAmount: updated.streetCommitted,
        });
        break;
      }

      if (currentBet === 0n) {
        const fullBet = toAmount >= state.minimumBet;
        const updated = commitActor(actor.stack, fullBet);
        currentBet = toAmount;
        if (fullBet) {
          minimumRaise = toAmount;
          lastFullRaise = toAmount;
        }
        events.push({ type: 'PLAYER_BET', playerId: actor.id, seat: actor.seat, amount: actor.stack });
        events.push({
          type: 'PLAYER_ALL_IN',
          playerId: actor.id,
          seat: actor.seat,
          kind: 'bet',
          toAmount: updated.streetCommitted,
        });
        break;
      }

      if (actor.actedSinceLastFullRaise) {
        throw new PokerRuleError('Action was not reopened by a full raise');
      }
      const raiseSize = toAmount - currentBet;
      const fullRaise = raiseSize >= minimumRaise;
      const updated = commitActor(actor.stack, fullRaise);
      currentBet = toAmount;
      if (fullRaise) {
        minimumRaise = raiseSize;
        lastFullRaise = raiseSize;
      }
      events.push({
        type: 'PLAYER_RAISED',
        playerId: actor.id,
        seat: actor.seat,
        amount: actor.stack,
        toAmount,
        raiseSize,
        fullRaise,
      });
      events.push({
        type: 'PLAYER_ALL_IN',
        playerId: actor.id,
        seat: actor.seat,
        kind: 'raise',
        toAmount: updated.streetCommitted,
      });
      break;
    }

    default: {
      const unsupported: never = action;
      throw new PokerRuleError(`Unsupported poker action: ${String(unsupported)}`);
    }
  }

  const actionSequence = state.actionSequence + 1;
  const probe: BettingRoundState = {
    ...state,
    players,
    currentBet,
    minimumRaise,
    lastFullRaise,
    actionSequence,
  };
  const complete = isBettingRoundComplete(probe);
  const actingSeat = complete ? null : nextActorSeat(players, actor.seat);
  if (!complete && actingSeat === null) {
    throw new Error('No eligible next actor for an incomplete betting round');
  }

  if (complete) events.push({ type: 'BETTING_ROUND_COMPLETE', actionSequence });

  const nextState = freezeBettingRoundState({
    ...probe,
    actingSeat,
    status: complete ? 'complete' : 'active',
  });
  assertBettingRoundInvariants(nextState);
  return Object.freeze({ state: nextState, events: freezeEvents(events) });
};
