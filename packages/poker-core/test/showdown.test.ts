import { describe, expect, it } from 'vitest';

import type { HandRank } from '../src/hand-ranking.js';
import { determinePotWinners } from '../src/showdown.js';
import type { ConstructedPot } from '../src/pots.js';

const rank = (category: HandRank['category'], tiebreak: readonly number[]): HandRank => ({
  category,
  tiebreak,
});

const pot = (
  index: number,
  eligiblePlayerIds: readonly string[],
  amount = 100n,
): ConstructedPot => ({
  index,
  type: index === 0 ? 'main' : 'side',
  amount,
  contributorIds: eligiblePlayerIds,
  eligiblePlayerIds,
});

describe('showdown pot winner determination', () => {
  it('selects the strongest eligible hand', () => {
    const result = determinePotWinners(
      [pot(0, ['alice', 'bob'])],
      [
        { playerId: 'alice', rank: rank('one-pair', [14, 13, 9, 4]) },
        { playerId: 'bob', rank: rank('two-pair', [10, 8, 14]) },
      ],
    );

    expect(result).toEqual([{ potIndex: 0, winnerIds: ['bob'] }]);
  });

  it('returns every tied winner without allocating CHIP', () => {
    const tied = rank('straight', [9]);
    const result = determinePotWinners(
      [pot(0, ['alice', 'bob', 'carol'], 101n)],
      [
        { playerId: 'alice', rank: tied },
        { playerId: 'bob', rank: rank('two-pair', [14, 13, 12]) },
        { playerId: 'carol', rank: tied },
      ],
    );

    expect(result).toEqual([{ potIndex: 0, winnerIds: ['alice', 'carol'] }]);
  });

  it('resolves main and side pots independently by eligibility', () => {
    const result = determinePotWinners(
      [
        pot(0, ['alice', 'bob', 'carol'], 150n),
        pot(1, ['bob', 'carol'], 100n),
      ],
      [
        { playerId: 'alice', rank: rank('flush', [14, 11, 9, 7, 3]) },
        { playerId: 'bob', rank: rank('straight', [10]) },
        { playerId: 'carol', rank: rank('three-of-a-kind', [12, 9, 4]) },
      ],
    );

    expect(result).toEqual([
      { potIndex: 0, winnerIds: ['alice'] },
      { potIndex: 1, winnerIds: ['bob'] },
    ]);
  });

  it('does not allow an ineligible stronger hand to win a side pot', () => {
    const result = determinePotWinners(
      [pot(0, ['bob', 'carol'])],
      [
        { playerId: 'alice', rank: rank('straight-flush', [14]) },
        { playerId: 'bob', rank: rank('one-pair', [10, 9, 8, 7]) },
        { playerId: 'carol', rank: rank('high-card', [14, 12, 9, 7, 4]) },
      ],
    );

    expect(result).toEqual([{ potIndex: 0, winnerIds: ['bob'] }]);
  });

  it('preserves canonical eligibility order for tied winners and is immutable', () => {
    const tied = rank('full-house', [8, 2]);
    const pots = [pot(0, ['carol', 'alice'])];
    const players = [
      { playerId: 'alice', rank: tied },
      { playerId: 'carol', rank: tied },
    ];
    const potsSnapshot = pots.map((entry) => ({ ...entry }));
    const playersSnapshot = players.map((entry) => ({ ...entry }));

    const result = determinePotWinners(pots, players);

    expect(result).toEqual([{ potIndex: 0, winnerIds: ['carol', 'alice'] }]);
    expect(pots).toEqual(potsSnapshot);
    expect(players).toEqual(playersSnapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0]?.winnerIds)).toBe(true);
  });

  it('rejects missing or duplicate ranked players', () => {
    expect(() =>
      determinePotWinners(
        [pot(0, ['alice', 'bob'])],
        [{ playerId: 'alice', rank: rank('high-card', [14, 12, 9, 7, 4]) }],
      ),
    ).toThrow(/missing showdown rank/i);

    expect(() =>
      determinePotWinners(
        [pot(0, ['alice'])],
        [
          { playerId: 'alice', rank: rank('high-card', [14, 12, 9, 7, 4]) },
          { playerId: 'alice', rank: rank('high-card', [13, 12, 9, 7, 4]) },
        ],
      ),
    ).toThrow(/duplicate ranked/i);
  });

  it('rejects malformed ranks and noncanonical pot structures', () => {
    expect(() =>
      determinePotWinners(
        [pot(0, ['alice'])],
        [{ playerId: 'alice', rank: rank('straight', [4]) }],
      ),
    ).toThrow(/invalid tiebreak/i);

    expect(() =>
      determinePotWinners(
        [pot(1, ['alice'])],
        [{ playerId: 'alice', rank: rank('straight', [9]) }],
      ),
    ).toThrow(/canonical contiguous indexes/i);

    expect(() =>
      determinePotWinners(
        [pot(0, [])],
        [{ playerId: 'alice', rank: rank('straight', [9]) }],
      ),
    ).toThrow(/at least one eligible/i);
  });
});
