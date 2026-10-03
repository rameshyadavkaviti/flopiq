import { addChips, assertChipAmount, chips, type ChipAmount } from './money.js';
import {
  assertPotConstructionInvariants,
  type PotConstructionResult,
  type PotParticipant,
} from './pots.js';
import type { PotWinnerResult } from './showdown.js';
import type { BettingPlayerState } from './state.js';

export interface PotWinnerPayout {
  readonly playerId: string;
  readonly seat: number;
  readonly amount: ChipAmount;
}

export interface AwardedPot {
  readonly potIndex: number;
  readonly amount: ChipAmount;
  readonly payouts: readonly PotWinnerPayout[];
}

export interface SettledPlayer {
  readonly playerId: string;
  readonly seat: number;
  readonly startingStack: ChipAmount;
  readonly potAward: ChipAmount;
  readonly uncalledRefund: ChipAmount;
  readonly endingStack: ChipAmount;
}

export interface PotAwardSettlement {
  readonly pots: readonly AwardedPot[];
  readonly players: readonly SettledPlayer[];
  readonly awardedPots: ChipAmount;
  readonly refundedUncalled: ChipAmount;
  readonly totalChips: ChipAmount;
}

const assertSeat = (seat: number): void => {
  if (!Number.isSafeInteger(seat) || seat < 0 || seat > 8) {
    throw new RangeError('Seat must be an integer from 0 through 8');
  }
};

const freezeSettlement = (settlement: PotAwardSettlement): PotAwardSettlement =>
  Object.freeze({
    ...settlement,
    pots: Object.freeze(
      settlement.pots.map((pot) =>
        Object.freeze({
          ...pot,
          payouts: Object.freeze(pot.payouts.map((payout) => Object.freeze({ ...payout }))),
        }),
      ),
    ),
    players: Object.freeze(settlement.players.map((player) => Object.freeze({ ...player }))),
  });

const clockwiseDistanceFromButton = (seat: number, buttonSeat: number): number => {
  const distance = (seat - buttonSeat + 9) % 9;
  return distance === 0 ? 9 : distance;
};

export const settlePotAwards = (
  input: readonly BettingPlayerState[],
  construction: PotConstructionResult,
  winners: readonly PotWinnerResult[],
  buttonSeat: number,
): PotAwardSettlement => {
  if (!Array.isArray(input)) throw new TypeError('Settlement players must be an array');
  if (!Array.isArray(winners)) throw new TypeError('Settlement winners must be an array');
  assertSeat(buttonSeat);

  const participants: readonly PotParticipant[] = input.map((player) => ({
    id: player.id,
    seat: player.seat,
    handCommitted: player.handCommitted,
    folded: player.folded,
  }));
  assertPotConstructionInvariants(participants, construction);

  const playersById = new Map<string, BettingPlayerState>();
  const occupiedSeats = new Set<number>();
  let totalBefore = chips(0n);

  for (const player of input) {
    assertChipAmount(player.stack);
    if (playersById.has(player.id)) throw new Error(`Duplicate settlement player: ${player.id}`);
    if (occupiedSeats.has(player.seat)) throw new Error(`Duplicate settlement seat: ${player.seat}`);
    playersById.set(player.id, player);
    occupiedSeats.add(player.seat);
    totalBefore = addChips(totalBefore, addChips(player.stack, player.handCommitted));
  }

  if (!occupiedSeats.has(buttonSeat)) {
    throw new Error('Settlement button seat must identify a hand participant');
  }
  if (winners.length !== construction.pots.length) {
    throw new Error('Settlement requires exactly one winner result per constructed pot');
  }

  const awardsByPlayer = new Map<string, ChipAmount>();
  const awardedPots: AwardedPot[] = [];
  let awardedTotal = chips(0n);

  for (const [index, pot] of construction.pots.entries()) {
    const result = winners[index];
    if (result === undefined || result.potIndex !== pot.index || result.potIndex !== index) {
      throw new Error('Settlement winner results must use canonical contiguous pot indexes');
    }
    const rawWinnerIds: unknown = result.winnerIds;
    if (!Array.isArray(rawWinnerIds) || rawWinnerIds.length === 0) {
      throw new Error('Settlement pot must have at least one winner');
    }
    if (
      !rawWinnerIds.every(
        (playerId): playerId is string => typeof playerId === 'string' && playerId.length > 0,
      )
    ) {
      throw new TypeError('Settlement winner identity must be a nonempty string');
    }
    const winnerIds: readonly string[] = rawWinnerIds;
    if (new Set(winnerIds).size !== winnerIds.length) {
      throw new Error('Settlement pot winner list contains duplicate players');
    }

    for (const playerId of winnerIds) {
      if (!pot.eligiblePlayerIds.includes(playerId)) {
        throw new Error(`Settlement winner is not eligible for pot: ${playerId}`);
      }
      if (!playersById.has(playerId)) {
        throw new Error(`Settlement winner is not a hand participant: ${playerId}`);
      }
    }

    const winnerCount = BigInt(winnerIds.length);
    const baseShare = pot.amount / winnerCount;
    const oddChipCount = Number(pot.amount % winnerCount);
    const payoutAmounts = new Map<string, ChipAmount>();

    for (const playerId of winnerIds) payoutAmounts.set(playerId, baseShare);

    const oddChipOrder = [...winnerIds].sort((leftId, rightId) => {
      const left = playersById.get(leftId);
      const right = playersById.get(rightId);
      if (left === undefined || right === undefined) {
        throw new Error('Settlement winner disappeared during odd-CHIP ordering');
      }

      const leftDistance = clockwiseDistanceFromButton(left.seat, buttonSeat);
      const rightDistance = clockwiseDistanceFromButton(right.seat, buttonSeat);
      return leftDistance - rightDistance;
    });

    for (let oddIndex = 0; oddIndex < oddChipCount; oddIndex += 1) {
      const playerId = oddChipOrder[oddIndex];
      if (playerId === undefined) throw new Error('Odd-CHIP recipient disappeared');
      const previous = payoutAmounts.get(playerId);
      if (previous === undefined) throw new Error('Odd-CHIP recipient has no base payout');
      payoutAmounts.set(playerId, addChips(previous, 1n));
    }

    let potAwarded = chips(0n);
    const payouts = winnerIds
      .map((playerId) => {
        const player = playersById.get(playerId);
        const amount = payoutAmounts.get(playerId);
        if (player === undefined || amount === undefined) {
          throw new Error('Settlement payout participant disappeared');
        }
        potAwarded = addChips(potAwarded, amount);
        const previousAward = awardsByPlayer.get(playerId) ?? chips(0n);
        awardsByPlayer.set(playerId, addChips(previousAward, amount));
        return { playerId, seat: player.seat, amount };
      })
      .sort((left, right) => left.seat - right.seat);

    if (potAwarded !== pot.amount) throw new Error('Pot payout CHIP conservation invariant failed');

    awardedTotal = addChips(awardedTotal, potAwarded);
    awardedPots.push({ potIndex: pot.index, amount: pot.amount, payouts });
  }

  const refundsByPlayer = new Map<string, ChipAmount>();
  let refundedUncalled = chips(0n);
  for (const refund of construction.uncalled) {
    const previous = refundsByPlayer.get(refund.playerId) ?? chips(0n);
    refundsByPlayer.set(refund.playerId, addChips(previous, refund.amount));
    refundedUncalled = addChips(refundedUncalled, refund.amount);
  }

  let totalAfter = chips(0n);
  const players = input
    .map((player) => {
      const potAward = awardsByPlayer.get(player.id) ?? chips(0n);
      const uncalledRefund = refundsByPlayer.get(player.id) ?? chips(0n);
      const endingStack = addChips(addChips(player.stack, potAward), uncalledRefund);
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
    throw new Error('Settlement CHIP conservation invariant failed');
  }

  return freezeSettlement({
    pots: awardedPots,
    players,
    awardedPots: awardedTotal,
    refundedUncalled,
    totalChips: totalBefore,
  });
};
