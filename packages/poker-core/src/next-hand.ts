import {
  assertHandStateInvariants,
  createHand,
  type HandState,
} from './hand.js';
import { addChips, assertChipAmount, chips } from './money.js';
import { nextOccupiedSeat } from './positions.js';

interface SettledPlayerLike {
  readonly playerId: string;
  readonly seat: number;
  readonly endingStack: bigint;
}

const settledPlayersForNextHand = (
  previous: HandState,
): readonly SettledPlayerLike[] => {
  const completion = previous.completion;
  if (completion === null) throw new Error('Completed hand is missing settlement');

  const settled = completion.settlement.players;
  if (settled.length !== previous.betting.players.length) {
    throw new Error('Hand settlement does not cover every participant');
  }

  const seenIds = new Set<string>();
  const seenSeats = new Set<number>();
  let settledTotal = chips(0n);

  for (const player of settled) {
    if (seenIds.has(player.playerId)) {
      throw new Error(`Duplicate settled player: ${player.playerId}`);
    }
    if (seenSeats.has(player.seat)) {
      throw new Error(`Duplicate settled seat: ${player.seat}`);
    }

    const previousPlayer = previous.betting.players.find(
      (candidate) => candidate.id === player.playerId && candidate.seat === player.seat,
    );
    if (previousPlayer === undefined) {
      throw new Error('Hand settlement participant does not match the completed hand');
    }

    assertChipAmount(player.endingStack);
    settledTotal = addChips(settledTotal, player.endingStack);
    seenIds.add(player.playerId);
    seenSeats.add(player.seat);
  }

  if (settledTotal !== previous.betting.totalChips) {
    throw new Error('Next-hand CHIP conservation invariant failed');
  }

  return settled;
};

export const createNextHand = (previous: HandState): HandState => {
  assertHandStateInvariants(previous);
  if (previous.phase !== 'complete') {
    throw new Error('Next hand requires a completed hand');
  }

  const settled = settledPlayersForNextHand(previous);
  const players = settled
    .filter((player) => player.endingStack > 0n)
    .map((player) => ({
      id: player.playerId,
      seat: player.seat,
      stack: player.endingStack,
    }))
    .sort((left, right) => left.seat - right.seat);

  if (players.length < 2) {
    throw new Error('Next hand requires at least two players with CHIP');
  }

  const buttonSeat = nextOccupiedSeat(
    players.map((player) => player.seat),
    previous.buttonSeat,
  );
  const next = createHand({
    players,
    buttonSeat,
    smallBlind: previous.smallBlind,
    bigBlind: previous.bigBlind,
  });

  if (next.betting.totalChips !== previous.betting.totalChips) {
    throw new Error('Next hand changed the table CHIP total');
  }

  return next;
};
