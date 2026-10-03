import { compareHandRanks, type HandRank } from './hand-ranking.js';
import type { ConstructedPot } from './pots.js';

export interface RankedShowdownPlayer {
  readonly playerId: string;
  readonly rank: HandRank;
}

export interface PotWinnerResult {
  readonly potIndex: number;
  readonly winnerIds: readonly string[];
}

const freezeResults = (results: readonly PotWinnerResult[]): readonly PotWinnerResult[] =>
  Object.freeze(
    results.map((result) =>
      Object.freeze({ ...result, winnerIds: Object.freeze([...result.winnerIds]) }),
    ),
  );

export const determinePotWinners = (
  pots: readonly ConstructedPot[],
  rankedPlayers: readonly RankedShowdownPlayer[],
): readonly PotWinnerResult[] => {
  if (!Array.isArray(pots)) throw new TypeError('Showdown pots must be an array');
  if (!Array.isArray(rankedPlayers)) throw new TypeError('Ranked showdown players must be an array');

  const ranks = new Map<string, HandRank>();
  for (const player of rankedPlayers) {
    if (typeof player !== 'object' || player === null) {
      throw new TypeError('Ranked showdown player must be an object');
    }
    if (typeof player.playerId !== 'string' || player.playerId.length === 0) {
      throw new TypeError('Ranked showdown player identity must be nonempty');
    }
    if (ranks.has(player.playerId)) {
      throw new Error(`Duplicate ranked showdown player: ${player.playerId}`);
    }
    ranks.set(player.playerId, player.rank);
  }

  const results = pots.map((pot, index) => {
    if (pot.index !== index) throw new Error('Showdown pots must use canonical contiguous indexes');
    if (!Array.isArray(pot.eligiblePlayerIds) || pot.eligiblePlayerIds.length === 0) {
      throw new Error('Showdown pot must have at least one eligible player');
    }
    if (new Set(pot.eligiblePlayerIds).size !== pot.eligiblePlayerIds.length) {
      throw new Error('Showdown pot eligibility contains duplicate players');
    }

    let bestRank: HandRank | null = null;
    const winnerIds: string[] = [];
    for (const playerId of pot.eligiblePlayerIds) {
      const rank = ranks.get(playerId);
      if (rank === undefined) {
        throw new Error(`Missing showdown rank for eligible player: ${playerId}`);
      }
      if (bestRank === null) {
        compareHandRanks(rank, rank);
        bestRank = rank;
        winnerIds.push(playerId);
        continue;
      }

      const comparison = compareHandRanks(rank, bestRank);
      if (comparison > 0) {
        bestRank = rank;
        winnerIds.splice(0, winnerIds.length, playerId);
      } else if (comparison === 0) {
        winnerIds.push(playerId);
      }
    }

    return { potIndex: pot.index, winnerIds };
  });

  return freezeResults(results);
};
