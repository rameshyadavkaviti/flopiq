import { assertBettingRoundInvariants } from './invariants.js';
import {
  createBettingRoundState,
  type BettingPlayerState,
  type BettingRoundState,
} from './state.js';

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';

const assertSeat = (seat: number): void => {
  if (!Number.isSafeInteger(seat) || seat < 0 || seat > 8) {
    throw new RangeError('First-to-act seat must be an integer from 0 through 8');
  }
};

const firstActionableSeat = (
  players: readonly BettingPlayerState[],
  firstToActSeat: number,
): number | null => {
  const contenders = players.filter((player) => !player.folded);
  const actionable = contenders.filter((player) => !player.allIn);
  if (contenders.length <= 1 || actionable.length <= 1) return null;

  return [...actionable]
    .sort((left, right) => {
      const leftDistance = (left.seat - firstToActSeat + 9) % 9;
      const rightDistance = (right.seat - firstToActSeat + 9) % 9;
      return leftDistance - rightDistance;
    })[0]?.seat ?? null;
};

export const createNextStreetBettingRound = (
  previous: BettingRoundState,
  firstToActSeat: number,
): BettingRoundState => {
  assertBettingRoundInvariants(previous);
  if (previous.status !== 'complete') {
    throw new Error('The previous betting round must be complete');
  }

  assertSeat(firstToActSeat);
  if (!previous.players.some((player) => player.seat === firstToActSeat)) {
    throw new Error('First-to-act seat must identify a hand participant');
  }

  const players = previous.players.map((player): BettingPlayerState => ({
    ...player,
    streetCommitted: 0n,
    actedSinceLastFullRaise: false,
  }));

  return createBettingRoundState({
    players,
    actingSeat: firstActionableSeat(players, firstToActSeat),
    currentBet: 0n,
    minimumBet: previous.minimumBet,
    minimumRaise: previous.minimumBet,
    lastFullRaise: previous.minimumBet,
  });
};
