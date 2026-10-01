import {
  addChips,
  assertChipAmount,
  chips,
  subtractChips,
  type ChipAmount,
} from './money.js';
import type { BettingPlayerState } from './state.js';

export type PotParticipant = Pick<
  BettingPlayerState,
  'id' | 'seat' | 'handCommitted' | 'folded'
>;

export interface ConstructedPot {
  readonly index: number;
  readonly type: 'main' | 'side';
  readonly amount: ChipAmount;
  readonly contributorIds: readonly string[];
  readonly eligiblePlayerIds: readonly string[];
}

export interface UncalledChips {
  readonly playerId: string;
  readonly seat: number;
  readonly amount: ChipAmount;
}

export interface PotConstructionResult {
  readonly pots: readonly ConstructedPot[];
  readonly uncalled: readonly UncalledChips[];
}

const assertSeat = (seat: number): void => {
  if (!Number.isInteger(seat) || seat < 0 || seat > 8) {
    throw new RangeError('Seat must be an integer from 0 through 8');
  }
};

const validateParticipants = (
  players: readonly PotParticipant[],
): readonly PotParticipant[] => {
  if (!Array.isArray(players)) throw new TypeError('Pot participants must be an array');
  if (players.length < 2 || players.length > 9) {
    throw new RangeError('Pot construction requires 2 through 9 players');
  }

  const playerIds = new Set<string>();
  const seats = new Set<number>();
  const validated = players.map((player) => {
    if (typeof player !== 'object' || player === null) {
      throw new TypeError('Pot participant must be an object');
    }
    if (typeof player.id !== 'string' || player.id.length === 0) {
      throw new TypeError('Player identity must be a nonempty string');
    }
    assertSeat(player.seat);
    assertChipAmount(player.handCommitted);
    if (typeof player.folded !== 'boolean') {
      throw new TypeError('Player folded state must be boolean');
    }
    if (playerIds.has(player.id)) throw new Error(`Duplicate player identity: ${player.id}`);
    if (seats.has(player.seat)) throw new Error(`Duplicate seat: ${player.seat}`);
    playerIds.add(player.id);
    seats.add(player.seat);
    return player;
  });

  if (!validated.some((player) => !player.folded)) {
    throw new Error('Pot construction requires at least one eligible player');
  }

  return validated.sort((left, right) => left.seat - right.seat);
};

const freezePot = (pot: ConstructedPot): ConstructedPot =>
  Object.freeze({
    ...pot,
    contributorIds: Object.freeze([...pot.contributorIds]),
    eligiblePlayerIds: Object.freeze([...pot.eligiblePlayerIds]),
  });

const freezeResult = (result: PotConstructionResult): PotConstructionResult =>
  Object.freeze({
    pots: Object.freeze(result.pots.map(freezePot)),
    uncalled: Object.freeze(result.uncalled.map((refund) => Object.freeze({ ...refund }))),
  });

const buildPotConstruction = (
  players: readonly PotParticipant[],
): PotConstructionResult => {
  const commitmentLevels = [...new Set(players.map((player) => player.handCommitted))]
    .filter((commitment) => commitment > 0n)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const pots: ConstructedPot[] = [];
  const uncalled: UncalledChips[] = [];
  let previousLevel = chips(0n);

  for (const commitmentLevel of commitmentLevels) {
    const layerWidth = subtractChips(commitmentLevel, previousLevel);
    const contributors = players.filter(
      (player) => player.handCommitted >= commitmentLevel,
    );

    if (contributors.length === 1) {
      const contributor = contributors[0];
      if (contributor === undefined) throw new Error('Uncalled contributor disappeared');
      if (contributor.folded) {
        throw new Error('Folded player cannot receive uncalled CHIP');
      }
      uncalled.push({
        playerId: contributor.id,
        seat: contributor.seat,
        amount: layerWidth,
      });
      previousLevel = commitmentLevel;
      continue;
    }

    const eligiblePlayers = contributors.filter((player) => !player.folded);
    if (eligiblePlayers.length === 0) {
      throw new Error('Pot layer has contributors but no eligible player');
    }

    const index = pots.length;
    pots.push({
      index,
      type: index === 0 ? 'main' : 'side',
      amount: layerWidth * BigInt(contributors.length),
      contributorIds: contributors.map((player) => player.id),
      eligiblePlayerIds: eligiblePlayers.map((player) => player.id),
    });
    previousLevel = commitmentLevel;
  }

  return freezeResult({ pots, uncalled });
};

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameConstruction = (
  left: PotConstructionResult,
  right: PotConstructionResult,
): boolean =>
  left.pots.length === right.pots.length &&
  left.uncalled.length === right.uncalled.length &&
  left.pots.every((pot, index) => {
    const expected = right.pots[index];
    return (
      expected !== undefined &&
      pot.index === expected.index &&
      pot.type === expected.type &&
      pot.amount === expected.amount &&
      sameStrings(pot.contributorIds, expected.contributorIds) &&
      sameStrings(pot.eligiblePlayerIds, expected.eligiblePlayerIds)
    );
  }) &&
  left.uncalled.every((refund, index) => {
    const expected = right.uncalled[index];
    return (
      expected !== undefined &&
      refund.playerId === expected.playerId &&
      refund.seat === expected.seat &&
      refund.amount === expected.amount
    );
  });

export const assertPotConstructionInvariants = (
  input: readonly PotParticipant[],
  result: PotConstructionResult,
): void => {
  const players = validateParticipants(input);
  if (typeof result !== 'object' || result === null) {
    throw new TypeError('Pot construction result must be an object');
  }
  if (!Array.isArray(result.pots) || !Array.isArray(result.uncalled)) {
    throw new TypeError('Pot construction result must contain pot and uncalled arrays');
  }

  let inputTotal = chips(0n);
  for (const player of players) inputTotal = addChips(inputTotal, player.handCommitted);

  let outputTotal = chips(0n);
  for (const pot of result.pots) {
    assertChipAmount(pot.amount);
    if (pot.amount === 0n) throw new Error('Pot amount must be positive');
    outputTotal = addChips(outputTotal, pot.amount);

    const eligible = new Set(pot.eligiblePlayerIds);
    for (const playerId of eligible) {
      const player = players.find((candidate) => candidate.id === playerId);
      if (player === undefined || player.folded || !pot.contributorIds.includes(playerId)) {
        throw new Error('Pot eligibility invariant failed');
      }
    }
  }
  for (const refund of result.uncalled) {
    assertChipAmount(refund.amount);
    if (refund.amount === 0n) throw new Error('Uncalled amount must be positive');
    outputTotal = addChips(outputTotal, refund.amount);
  }

  if (inputTotal !== outputTotal) {
    throw new Error('Pot CHIP conservation invariant failed');
  }

  const expected = buildPotConstruction(players);
  if (!sameConstruction(result, expected)) {
    throw new Error('Pot construction is not canonical for its participants');
  }
};

export const constructPots = (
  input: readonly PotParticipant[],
): PotConstructionResult => {
  const players = validateParticipants(input);
  const result = buildPotConstruction(players);
  assertPotConstructionInvariants(players, result);
  return result;
};
