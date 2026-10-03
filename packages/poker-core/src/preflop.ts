import { assertChipAmount, type ChipAmount } from './money.js';
import { assignHandPositions } from './positions.js';
import { createBettingRoundState, type BettingPlayerState, type BettingRoundState } from './state.js';

export interface HandStartPlayer {
  readonly id: string;
  readonly seat: number;
  readonly stack: ChipAmount;
}

export interface CreatePreflopRoundInput {
  readonly players: readonly HandStartPlayer[];
  readonly buttonSeat: number;
  readonly smallBlind: ChipAmount;
  readonly bigBlind: ChipAmount;
}

const validateBlinds = (smallBlind: ChipAmount, bigBlind: ChipAmount): void => {
  assertChipAmount(smallBlind);
  assertChipAmount(bigBlind);
  if (smallBlind === 0n || bigBlind === 0n) {
    throw new RangeError('Blinds must be positive');
  }
  if (smallBlind >= bigBlind) {
    throw new RangeError('Small blind must be less than big blind');
  }
};

const forcedBlindForSeat = (
  seat: number,
  smallBlindSeat: number,
  bigBlindSeat: number,
  smallBlind: ChipAmount,
  bigBlind: ChipAmount,
): ChipAmount => {
  if (seat === smallBlindSeat) return smallBlind;
  if (seat === bigBlindSeat) return bigBlind;
  return 0n;
};

const firstActionableSeat = (
  players: readonly BettingPlayerState[],
  firstSeat: number,
  currentBet: ChipAmount,
): number | null => {
  const actionable = players.filter((player) => !player.folded && !player.allIn);
  if (actionable.length === 0) return null;
  if (actionable.length === 1 && actionable[0]?.streetCommitted === currentBet) return null;

  const ordered = [...actionable].sort((left, right) => {
    const leftDistance = (left.seat - firstSeat + 9) % 9;
    const rightDistance = (right.seat - firstSeat + 9) % 9;
    return leftDistance - rightDistance;
  });
  return ordered[0]?.seat ?? null;
};

export const createPreflopBettingRound = (
  input: CreatePreflopRoundInput,
): BettingRoundState => {
  validateBlinds(input.smallBlind, input.bigBlind);

  const positions = assignHandPositions(
    input.players.map((player) => player.seat),
    input.buttonSeat,
  );

  const players = input.players.map((player): BettingPlayerState => {
    assertChipAmount(player.stack);
    const forcedBlind = forcedBlindForSeat(
      player.seat,
      positions.smallBlindSeat,
      positions.bigBlindSeat,
      input.smallBlind,
      input.bigBlind,
    );

    if (forcedBlind > player.stack) {
      throw new RangeError('Short blind stacks are not supported by this prototype initializer');
    }

    const stack = player.stack - forcedBlind;
    return {
      id: player.id,
      seat: player.seat,
      stack,
      streetCommitted: forcedBlind,
      handCommitted: forcedBlind,
      folded: false,
      allIn: stack === 0n,
      actedSinceLastFullRaise: false,
    };
  });

  const actingSeat = firstActionableSeat(
    players,
    positions.preflopFirstSeat,
    input.bigBlind,
  );

  return createBettingRoundState({
    players,
    actingSeat,
    currentBet: input.bigBlind,
    minimumBet: input.bigBlind,
    minimumRaise: input.bigBlind,
    lastFullRaise: input.bigBlind,
  });
};
