import { addChips, chips, type ChipAmount } from './money.js';
import { constructPots, type PotParticipant } from './pots.js';
import type { BettingPlayerState } from './state.js';

export interface TerminalFoldPlayerResult {
  readonly playerId: string;
  readonly seat: number;
  readonly startingStack: ChipAmount;
  readonly potAward: ChipAmount;
  readonly uncalledRefund: ChipAmount;
  readonly endingStack: ChipAmount;
}

export interface TerminalFoldResolution {
  readonly winnerId: string;
  readonly winnerSeat: number;
  readonly players: readonly TerminalFoldPlayerResult[];
  readonly awardedPots: ChipAmount;
  readonly refundedUncalled: ChipAmount;
  readonly totalChips: ChipAmount;
}

const freezeResolution = (resolution: TerminalFoldResolution): TerminalFoldResolution =>
  Object.freeze({
    ...resolution,
    players: Object.freeze(resolution.players.map((player) => Object.freeze({ ...player }))),
  });

export const resolveTerminalFold = (
  input: readonly BettingPlayerState[],
): TerminalFoldResolution => {
  if (!Array.isArray(input)) throw new TypeError('Terminal-fold players must be an array');

  const contenders = input.filter((player) => !player.folded);
  if (contenders.length !== 1) {
    throw new Error('Terminal-fold resolution requires exactly one non-folded player');
  }
  const winner = contenders[0];
  if (winner === undefined) throw new Error('Terminal-fold winner disappeared');

  const participants: readonly PotParticipant[] = input.map((player) => ({
    id: player.id,
    seat: player.seat,
    handCommitted: player.handCommitted,
    folded: player.folded,
  }));
  const construction = constructPots(participants);

  let awardedPots = chips(0n);
  for (const pot of construction.pots) {
    if (
      pot.eligiblePlayerIds.length !== 1 ||
      pot.eligiblePlayerIds[0] !== winner.id
    ) {
      throw new Error('Terminal-fold pot must be eligible only to the surviving player');
    }
    awardedPots = addChips(awardedPots, pot.amount);
  }

  const potAwards = new Map<string, ChipAmount>();
  potAwards.set(winner.id, awardedPots);

  const refunds = new Map<string, ChipAmount>();
  let refundedUncalled = chips(0n);
  for (const refund of construction.uncalled) {
    const previous = refunds.get(refund.playerId) ?? chips(0n);
    refunds.set(refund.playerId, addChips(previous, refund.amount));
    refundedUncalled = addChips(refundedUncalled, refund.amount);
  }

  let totalBefore = chips(0n);
  let totalAfter = chips(0n);
  const players = input
    .map((player) => {
      const potAward = potAwards.get(player.id) ?? chips(0n);
      const uncalledRefund = refunds.get(player.id) ?? chips(0n);
      const endingStack = addChips(addChips(player.stack, potAward), uncalledRefund);
      totalBefore = addChips(totalBefore, addChips(player.stack, player.handCommitted));
      totalAfter = addChips(totalAfter, endingStack);
      return {
        playerId: player.id,
        seat: player.seat,
        startingStack: player.stack,
        potAward,
        uncalledRefund,
        endingStack,
      };
    })
    .sort((left, right) => left.seat - right.seat);

  if (totalBefore !== totalAfter) {
    throw new Error('Terminal-fold CHIP conservation invariant failed');
  }

  return freezeResolution({
    winnerId: winner.id,
    winnerSeat: winner.seat,
    players,
    awardedPots,
    refundedUncalled,
    totalChips: totalBefore,
  });
};
