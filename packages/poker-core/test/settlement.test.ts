import { describe, expect, it } from 'vitest';

import { constructPots } from '../src/pots.js';
import { settlePotAwards } from '../src/settlement.js';
import type { PotWinnerResult } from '../src/showdown.js';
import type { BettingPlayerState } from '../src/state.js';

const player = (
  id: string,
  seat: number,
  stack: bigint,
  handCommitted: bigint,
  folded = false,
): BettingPlayerState => ({
  id,
  seat,
  stack,
  streetCommitted: handCommitted,
  handCommitted,
  folded,
  allIn: stack === 0n,
  actedSinceLastFullRaise: true,
});

const winners = (...entries: Array<readonly [number, readonly string[]]>): readonly PotWinnerResult[] =>
  entries.map(([potIndex, winnerIds]) => ({ potIndex, winnerIds }));

describe('deterministic pot awarding', () => {
  it('awards a single-winner pot and preserves CHIP conservation', () => {
    const players = [
      player('alice', 0, 50n, 50n),
      player('bob', 1, 50n, 50n),
    ];
    const construction = constructPots(players);

    const result = settlePotAwards(players, construction, winners([0, ['alice']]), 0);

    expect(result.pots).toEqual([
      {
        potIndex: 0,
        amount: 100n,
        payouts: [{ playerId: 'alice', seat: 0, amount: 100n }],
      },
    ]);
    expect(result.players).toEqual([
      {
        playerId: 'alice',
        seat: 0,
        startingStack: 50n,
        potAward: 100n,
        uncalledRefund: 0n,
        endingStack: 150n,
      },
      {
        playerId: 'bob',
        seat: 1,
        startingStack: 50n,
        potAward: 0n,
        uncalledRefund: 0n,
        endingStack: 50n,
      },
    ]);
    expect(result.totalChips).toBe(200n);
  });

  it('allocates an odd CHIP clockwise from the button among tied winners', () => {
    const players = [
      player('alice', 2, 100n, 1n),
      player('bob', 5, 100n, 1n, true),
      player('carol', 7, 100n, 1n),
    ];
    const construction = constructPots(players);

    const result = settlePotAwards(
      players,
      construction,
      winners([0, ['alice', 'carol']]),
      5,
    );

    expect(result.pots[0]?.payouts).toEqual([
      { playerId: 'alice', seat: 2, amount: 1n },
      { playerId: 'carol', seat: 7, amount: 2n },
    ]);
    expect(result.players.reduce((sum, entry) => sum + entry.endingStack, 0n)).toBe(303n);
  });

  it('places the button last for odd-CHIP priority and ignores winner input order', () => {
    const players = [
      player('alice', 2, 100n, 1n),
      player('bob', 5, 100n, 1n, true),
      player('carol', 7, 100n, 1n),
    ];
    const construction = constructPots(players);

    const first = settlePotAwards(
      players,
      construction,
      winners([0, ['carol', 'alice']]),
      7,
    );
    const second = settlePotAwards(
      [...players].reverse(),
      construction,
      winners([0, ['alice', 'carol']]),
      7,
    );

    expect(first).toEqual(second);
    expect(first.pots[0]?.payouts).toEqual([
      { playerId: 'alice', seat: 2, amount: 2n },
      { playerId: 'carol', seat: 7, amount: 1n },
    ]);
  });

  it('settles main and side pots independently with all-ins and folded dead money', () => {
    const players = [
      player('alice', 0, 0n, 50n),
      player('bob', 1, 0n, 100n),
      player('carol', 2, 100n, 100n),
      player('dave', 3, 150n, 50n, true),
    ];
    const construction = constructPots(players);

    const result = settlePotAwards(
      players,
      construction,
      winners([0, ['alice', 'carol']], [1, ['bob']]),
      3,
    );

    expect(construction.pots.map((pot) => pot.amount)).toEqual([200n, 100n]);
    expect(result.pots).toEqual([
      {
        potIndex: 0,
        amount: 200n,
        payouts: [
          { playerId: 'alice', seat: 0, amount: 100n },
          { playerId: 'carol', seat: 2, amount: 100n },
        ],
      },
      {
        potIndex: 1,
        amount: 100n,
        payouts: [{ playerId: 'bob', seat: 1, amount: 100n }],
      },
    ]);
    expect(result.players.find((entry) => entry.playerId === 'dave')?.potAward).toBe(0n);
    expect(result.players.reduce((sum, entry) => sum + entry.endingStack, 0n)).toBe(550n);
  });

  it('returns uncalled excess without mixing it into contested pot awards', () => {
    const players = [
      player('alice', 0, 70n, 30n, true),
      player('bob', 1, 40n, 60n),
    ];
    const construction = constructPots(players);

    const result = settlePotAwards(players, construction, winners([0, ['bob']]), 1);

    expect(result.awardedPots).toBe(60n);
    expect(result.refundedUncalled).toBe(30n);
    expect(result.players.find((entry) => entry.playerId === 'bob')).toMatchObject({
      potAward: 60n,
      uncalledRefund: 30n,
      endingStack: 130n,
    });
    expect(result.totalChips).toBe(200n);
  });

  it('rejects ineligible, duplicate, missing, and noncanonical winner results', () => {
    const players = [
      player('alice', 0, 90n, 10n),
      player('bob', 1, 90n, 10n, true),
      player('carol', 2, 90n, 10n),
    ];
    const construction = constructPots(players);

    expect(() =>
      settlePotAwards(players, construction, winners([0, ['bob']]), 0),
    ).toThrow(/not eligible/i);

    expect(() =>
      settlePotAwards(players, construction, winners([0, ['alice', 'alice']]), 0),
    ).toThrow(/duplicate/i);

    expect(() => settlePotAwards(players, construction, [], 0)).toThrow(/exactly one/i);

    expect(() =>
      settlePotAwards(players, construction, winners([1, ['alice']]), 0),
    ).toThrow(/canonical contiguous/i);
  });

  it('rejects malformed settlement context and corrupted pot construction', () => {
    const players = [
      player('alice', 0, 90n, 10n),
      player('bob', 1, 90n, 10n),
    ];
    const construction = constructPots(players);

    expect(() =>
      settlePotAwards(players, construction, winners([0, ['alice']]), 8),
    ).toThrow(/button seat/i);

    const firstPot = construction.pots[0];
    if (firstPot === undefined) throw new Error('Expected a constructed pot');
    const corrupted = {
      ...construction,
      pots: [{ ...firstPot, amount: 19n }],
    };

    expect(() =>
      settlePotAwards(players, corrupted, winners([0, ['alice']]), 0),
    ).toThrow(/conservation|canonical/i);
  });

  it('is immutable and preserves very large bigint CHIP amounts', () => {
    const huge = 9_000_000_000_000_000_000n;
    const players = [
      player('alice', 0, huge, huge),
      player('bob', 1, huge, huge),
    ];
    const snapshot = players.map((entry) => ({ ...entry }));
    const construction = constructPots(players);
    const result = settlePotAwards(players, construction, winners([0, ['bob']]), 0);

    expect(players).toEqual(snapshot);
    expect(result.totalChips).toBe(huge * 4n);
    expect(result.players.find((entry) => entry.playerId === 'bob')?.endingStack).toBe(huge * 3n);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.pots)).toBe(true);
    expect(Object.isFrozen(result.pots[0])).toBe(true);
    expect(Object.isFrozen(result.pots[0]?.payouts)).toBe(true);
    expect(Object.isFrozen(result.players)).toBe(true);
    expect(result.players.every(Object.isFrozen)).toBe(true);
  });
});
