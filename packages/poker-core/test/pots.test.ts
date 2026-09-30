import { describe, expect, it } from 'vitest';

import {
  assertPotConstructionInvariants,
  constructPots,
  type PotConstructionResult,
  type PotParticipant,
} from '../src/pots.js';

const participant = (
  id: string,
  seat: number,
  handCommitted: bigint,
  folded = false,
): PotParticipant => ({ id, seat, handCommitted, folded });

const totalCommitments = (players: readonly PotParticipant[]): bigint =>
  players.reduce((total, player) => total + player.handCommitted, 0n);

const totalConstructed = (result: PotConstructionResult): bigint =>
  result.pots.reduce((total, pot) => total + pot.amount, 0n) +
  result.uncalled.reduce((total, refund) => total + refund.amount, 0n);

describe('deterministic pot construction', () => {
  it('constructs a two-player equal main pot', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n),
    ]);

    expect(result).toEqual({
      pots: [
        {
          index: 0,
          type: 'main',
          amount: 200n,
          contributorIds: ['alice', 'bob'],
          eligiblePlayerIds: ['alice', 'bob'],
        },
      ],
      uncalled: [],
    });
  });

  it('constructs a three-player equal main pot', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n),
      participant('carol', 2, 100n),
    ]);

    expect(result.pots).toEqual([
      {
        index: 0,
        type: 'main',
        amount: 300n,
        contributorIds: ['alice', 'bob', 'carol'],
        eligiblePlayerIds: ['alice', 'bob', 'carol'],
      },
    ]);
    expect(result.uncalled).toEqual([]);
  });

  it('keeps folded CHIP in the pot but removes the player from eligibility', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n, true),
      participant('carol', 2, 100n),
    ]);

    expect(result.pots[0]).toEqual({
      index: 0,
      type: 'main',
      amount: 300n,
      contributorIds: ['alice', 'bob', 'carol'],
      eligiblePlayerIds: ['alice', 'carol'],
    });
  });

  it('constructs a main pot and side pot for one short all-in', () => {
    const result = constructPots([
      participant('alice', 0, 50n),
      participant('bob', 1, 100n),
      participant('carol', 2, 100n),
    ]);

    expect(result).toEqual({
      pots: [
        {
          index: 0,
          type: 'main',
          amount: 150n,
          contributorIds: ['alice', 'bob', 'carol'],
          eligiblePlayerIds: ['alice', 'bob', 'carol'],
        },
        {
          index: 1,
          type: 'side',
          amount: 100n,
          contributorIds: ['bob', 'carol'],
          eligiblePlayerIds: ['bob', 'carol'],
        },
      ],
      uncalled: [],
    });
  });

  it('constructs two side pots for multiple all-in levels', () => {
    const result = constructPots([
      participant('alice', 0, 50n),
      participant('bob', 1, 100n),
      participant('carol', 2, 200n),
      participant('dave', 3, 200n),
    ]);

    expect(result.pots.map((pot) => pot.amount)).toEqual([200n, 150n, 200n]);
    expect(result.pots.map((pot) => pot.eligiblePlayerIds)).toEqual([
      ['alice', 'bob', 'carol', 'dave'],
      ['bob', 'carol', 'dave'],
      ['carol', 'dave'],
    ]);
    expect(result.uncalled).toEqual([]);
  });

  it('constructs every layer across four distinct commitment levels', () => {
    const result = constructPots([
      participant('alice', 0, 25n),
      participant('bob', 1, 50n),
      participant('carol', 2, 100n),
      participant('dave', 3, 200n),
      participant('erin', 4, 200n),
    ]);

    expect(result.pots.map((pot) => pot.amount)).toEqual([125n, 100n, 150n, 200n]);
    expect(result.pots.map((pot) => pot.contributorIds)).toEqual([
      ['alice', 'bob', 'carol', 'dave', 'erin'],
      ['bob', 'carol', 'dave', 'erin'],
      ['carol', 'dave', 'erin'],
      ['dave', 'erin'],
    ]);
  });

  it('includes a folded player in every reached layer but never in eligibility', () => {
    const result = constructPots([
      participant('alice', 0, 50n),
      participant('bob', 1, 100n),
      participant('carol', 2, 200n, true),
      participant('dave', 3, 200n),
    ]);

    expect(result.pots.map((pot) => pot.contributorIds)).toEqual([
      ['alice', 'bob', 'carol', 'dave'],
      ['bob', 'carol', 'dave'],
      ['carol', 'dave'],
    ]);
    expect(result.pots.map((pot) => pot.eligiblePlayerIds)).toEqual([
      ['alice', 'bob', 'dave'],
      ['bob', 'dave'],
      ['dave'],
    ]);
    expect(result.pots.map((pot) => pot.amount)).toEqual([200n, 150n, 200n]);
  });

  it('returns unmatched CHIP to a uniquely largest folded contributor', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n),
      participant('carol', 2, 500n, true),
    ]);

    expect(result.pots).toEqual([
      {
        index: 0,
        type: 'main',
        amount: 300n,
        contributorIds: ['alice', 'bob', 'carol'],
        eligiblePlayerIds: ['alice', 'bob'],
      },
    ]);
    expect(result.uncalled).toEqual([{ playerId: 'carol', seat: 2, amount: 400n }]);
  });

  it('keeps several folded contributions while retaining only live eligibility', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n, true),
      participant('carol', 2, 100n, true),
    ]);

    expect(result.pots[0]?.amount).toBe(300n);
    expect(result.pots[0]?.contributorIds).toEqual(['alice', 'bob', 'carol']);
    expect(result.pots[0]?.eligiblePlayerIds).toEqual(['alice']);
  });

  it('represents uncalled excess explicitly instead of creating a one-player pot', () => {
    const result = constructPots([
      participant('alice', 0, 100n),
      participant('bob', 1, 100n),
      participant('carol', 2, 500n),
    ]);

    expect(result.pots).toHaveLength(1);
    expect(result.pots[0]?.amount).toBe(300n);
    expect(result.uncalled).toEqual([{ playerId: 'carol', seat: 2, amount: 400n }]);
  });

  it('excludes a zero-commitment player from pot contribution and eligibility', () => {
    const result = constructPots([
      participant('alice', 0, 0n),
      participant('bob', 1, 100n),
      participant('carol', 2, 100n),
    ]);

    expect(result.pots).toEqual([
      {
        index: 0,
        type: 'main',
        amount: 200n,
        contributorIds: ['bob', 'carol'],
        eligiblePlayerIds: ['bob', 'carol'],
      },
    ]);
    expect(result.uncalled).toEqual([]);
  });

  it('returns an empty construction when every commitment is zero', () => {
    expect(
      constructPots([participant('alice', 0, 0n), participant('bob', 1, 0n)]),
    ).toEqual({ pots: [], uncalled: [] });
  });

  it('constructs canonical pots for nine players', () => {
    const players = [
      participant('p8', 8, 300n),
      participant('p0', 0, 50n),
      participant('p5', 5, 200n, true),
      participant('p2', 2, 100n),
      participant('p7', 7, 300n),
      participant('p1', 1, 50n),
      participant('p6', 6, 200n),
      participant('p4', 4, 150n),
      participant('p3', 3, 100n),
    ];

    const result = constructPots(players);

    expect(result.pots.map((pot) => pot.amount)).toEqual([450n, 350n, 250n, 200n, 200n]);
    expect(result.pots[0]?.contributorIds).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
    ]);
    expect(result.pots[3]?.eligiblePlayerIds).toEqual(['p6', 'p7', 'p8']);
    expect(result.uncalled).toEqual([]);
  });

  it('preserves very large bigint CHIP amounts without numeric conversion', () => {
    const huge = 9_000_000_000_000_000_000n;
    const result = constructPots([
      participant('alice', 0, huge),
      participant('bob', 1, huge),
      participant('carol', 2, huge * 2n),
    ]);

    expect(result.pots[0]?.amount).toBe(huge * 3n);
    expect(result.uncalled).toEqual([{ playerId: 'carol', seat: 2, amount: huge }]);
    expect(totalConstructed(result)).toBe(huge * 4n);
  });

  it('rejects duplicate player identities', () => {
    expect(() =>
      constructPots([participant('alice', 0, 10n), participant('alice', 1, 10n)]),
    ).toThrow(/duplicate player/i);
  });

  it('rejects duplicate seats', () => {
    expect(() =>
      constructPots([participant('alice', 0, 10n), participant('bob', 0, 10n)]),
    ).toThrow(/duplicate seat/i);
  });

  it('rejects negative and malformed commitments', () => {
    expect(() =>
      constructPots([participant('alice', 0, -1n), participant('bob', 1, 10n)]),
    ).toThrow(/nonnegative/i);

    const malformed = [
      participant('alice', 0, 10n),
      { id: 'bob', seat: 1, handCommitted: 10, folded: false },
    ] as unknown as readonly PotParticipant[];
    expect(() => constructPots(malformed)).toThrow(/bigint/i);
  });

  it('rejects malformed or impossible participant structures', () => {
    expect(() => constructPots([participant('alice', 0, 10n)])).toThrow(/2 through 9/i);
    expect(() =>
      constructPots(
        Array.from({ length: 10 }, (_, seat) => participant(`player-${seat}`, seat, 0n)),
      ),
    ).toThrow(/2 through 9/i);
    expect(() =>
      constructPots([
        participant('alice', 0, 10n),
        participant('bob', 1, 20n, true),
        participant('carol', 2, 20n, true),
      ]),
    ).toThrow(/eligible/i);

    const malformed = [
      participant('alice', 0, 10n),
      { id: '', seat: 1, handCommitted: 10n, folded: false },
    ] as readonly PotParticipant[];
    expect(() => constructPots(malformed)).toThrow(/identity/i);

    const malformedFolded = [
      participant('alice', 0, 10n),
      { id: 'bob', seat: 1, handCommitted: 10n, folded: 0 },
    ] as unknown as readonly PotParticipant[];
    expect(() => constructPots(malformedFolded)).toThrow(/folded state/i);
  });

  it('enforces CHIP conservation for constructed and corrupted results', () => {
    const players = [
      participant('alice', 0, 50n),
      participant('bob', 1, 100n),
      participant('carol', 2, 500n),
    ];
    const result = constructPots(players);

    expect(totalConstructed(result)).toBe(totalCommitments(players));
    expect(() => assertPotConstructionInvariants(players, result)).not.toThrow();

    const corrupted = {
      ...result,
      pots: [{ ...result.pots[0], amount: 249n }, ...result.pots.slice(1)],
    } as PotConstructionResult;
    expect(() => assertPotConstructionInvariants(players, corrupted)).toThrow(/conservation/i);
  });

  it('returns identical canonical output regardless of input order', () => {
    const players = [
      participant('alice', 3, 50n),
      participant('bob', 1, 100n),
      participant('carol', 8, 200n, true),
      participant('dave', 2, 200n),
    ];

    const expected = constructPots(players);
    const shuffled = constructPots([...players].reverse());

    expect(shuffled).toEqual(expected);
    expect(expected.pots[0]?.contributorIds).toEqual(['bob', 'dave', 'alice', 'carol']);
  });

  it('preserves conservation across deterministic generated scenarios', () => {
    let seed = 0x5eed_1234;
    const next = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };

    for (let scenario = 0; scenario < 256; scenario += 1) {
      const playerCount = 2 + (next() % 8);
      const players = Array.from({ length: playerCount }, (_, seat) =>
        participant(
          `scenario-${scenario}-player-${seat}`,
          seat,
          BigInt(next() % 1_000_000),
        ),
      );

      const result = constructPots(players);
      expect(totalConstructed(result)).toBe(totalCommitments(players));
      expect(() => assertPotConstructionInvariants(players, result)).not.toThrow();
      expect(constructPots([...players].reverse())).toEqual(result);
    }
  });
});
