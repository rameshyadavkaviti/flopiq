import { addChips, assertChipAmount, chips, type ChipAmount } from './money.js';
import type { BettingPlayerState, BettingRoundState } from './state.js';

const assertSeat = (seat: number): void => {
  if (!Number.isInteger(seat) || seat < 0 || seat > 8) {
    throw new Error('Seat must be an integer from 0 through 8');
  }
};

const assertPlayer = (player: BettingPlayerState, currentBet: ChipAmount): void => {
  if (typeof player.id !== 'string' || player.id.length === 0) {
    throw new Error('Player identity must be a nonempty string');
  }
  assertSeat(player.seat);
  assertChipAmount(player.stack);
  assertChipAmount(player.streetCommitted);
  assertChipAmount(player.handCommitted);
  if (player.handCommitted < player.streetCommitted) {
    throw new Error('Hand commitment cannot be less than street commitment');
  }
  if (player.streetCommitted > currentBet) {
    throw new Error('Street commitment cannot exceed the current bet');
  }
  if (player.allIn !== (player.stack === 0n)) {
    throw new Error('All-in state must match a zero remaining stack');
  }
  if (player.folded && player.allIn) {
    throw new Error('A player cannot be folded and all-in');
  }
};

export const representedChips = (state: BettingRoundState): ChipAmount => {
  let total = chips(0n);
  for (const player of state.players) {
    assertChipAmount(player.stack);
    assertChipAmount(player.handCommitted);
    total = addChips(total, addChips(player.stack, player.handCommitted));
  }
  return total;
};

export const isBettingRoundComplete = (state: BettingRoundState): boolean => {
  const contenders = state.players.filter((player) => !player.folded);
  if (contenders.length <= 1) return true;

  const actionable = contenders.filter((player) => !player.allIn);
  if (actionable.length === 0) return true;

  return actionable.every(
    (player) =>
      player.actedSinceLastFullRaise && player.streetCommitted === state.currentBet,
  );
};

export const assertBettingRoundInvariants = (state: BettingRoundState): void => {
  if (state.players.length < 2 || state.players.length > 9) {
    throw new Error('A betting round must contain 2 through 9 players');
  }

  assertChipAmount(state.currentBet);
  assertChipAmount(state.minimumBet);
  assertChipAmount(state.minimumRaise);
  assertChipAmount(state.lastFullRaise);
  assertChipAmount(state.totalChips);
  if (state.minimumBet === 0n || state.minimumRaise === 0n || state.lastFullRaise === 0n) {
    throw new Error('Minimum bet and raise values must be positive');
  }
  if (state.minimumRaise !== state.lastFullRaise) {
    throw new Error('Minimum raise must equal the last full raise');
  }
  if (!Number.isSafeInteger(state.actionSequence) || state.actionSequence < 0) {
    throw new Error('Action sequence must be a nonnegative safe integer');
  }

  const seats = new Set<number>();
  const playerIds = new Set<string>();
  let maximumCommitment = chips(0n);
  for (const player of state.players) {
    assertPlayer(player, state.currentBet);
    if (seats.has(player.seat)) throw new Error(`Duplicate seat: ${player.seat}`);
    if (playerIds.has(player.id)) throw new Error(`Duplicate player identity: ${player.id}`);
    seats.add(player.seat);
    playerIds.add(player.id);
    if (player.streetCommitted > maximumCommitment) maximumCommitment = player.streetCommitted;
  }

  if (maximumCommitment !== state.currentBet) {
    throw new Error('Current bet must equal the largest street commitment');
  }
  if (representedChips(state) !== state.totalChips) {
    throw new Error('CHIP conservation invariant failed');
  }

  const roundComplete = isBettingRoundComplete(state);
  if (state.status === 'complete') {
    if (state.actingSeat !== null) throw new Error('A complete round cannot have an acting seat');
    if (!roundComplete) throw new Error('Complete round still requires player action');
    return;
  }
  if (state.status !== 'active') throw new Error('Unknown betting round status');
  if (roundComplete) throw new Error('Active round already satisfies completion conditions');
  if (state.actingSeat === null) throw new Error('An active round requires an acting seat');
  assertSeat(state.actingSeat);
  const actor = state.players.find((player) => player.seat === state.actingSeat);
  if (actor === undefined || actor.folded || actor.allIn) {
    throw new Error('Acting seat must identify a player who can act');
  }
};
