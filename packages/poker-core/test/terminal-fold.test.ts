import { describe, expect, it } from 'vitest';

import { resolveTerminalFold } from '../src/terminal-fold.js';
import type { BettingPlayerState } from '../src/state.js';

const player = (
  id: string,
  seat: number,
  stack: bigint,
  handCommitted: bigint,
  folded: boolean,
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

describe('terminal-fold resolution', () => {
  it('awards a heads-up pot to the sole surviving player', () => {
    const input = [
      player('alice', 0, 80n, 20n, false),
      player('bob', 1, 90n, 10n, true),
    ];

    const result = resolveTerminalFold(input);

    expect(result.winnerId).toBe('alice');
    expect(result.awardedPots).toBe(20n);
    expect(result.refundedUncalled).toBe(10n);
    expect(result.players).toEqual([
      {
        playerId: 'alice',
        seat: 0,
        startingStack: 80n,
        potAward: 20n,
        uncalledRefund: 10n,
        endingStack: 110n,
      },
      {
        playerId: 'bob',
        seat: 1,
        startingStack: 90n,
        potAward: 0n,
        uncalledRefund: 0n,
        endingStack: 90n,
      },
    ]);
    expect(result.totalChips).toBe(200n);
  });

  it('awards every contested side-pot layer to the sole survivor', () => {
    const input = [
      player('alice', 0, 50n, 50n, true),
      player('bob', 1, 100n, 100n, true),
      player('carol', 2, 200n, 200n, false),
      player('dave', 3, 100n, 200n, true),
    ];

    const result = resolveTerminalFold(input);

    expect(result.winnerId).toBe('carol');
    expect(result.awardedPots).toBe(550n);
    expect(result.refundedUncalled).toBe(0n);
    expect(result.players.find((entry) => entry.playerId === 'carol')?.endingStack).toBe(750n);
    expect(result.players.reduce((sum, entry) => sum + entry.endingStack, 0n)).toBe(1_000n);
  });

  it('keeps an uncalled excess separate from contested pot awards', () => {
    const input = [
      player('alice', 0, 70n, 30n, true),
      player('bob', 1, 40n, 60n, false),
    ];

    const result = resolveTerminalFold(input);

    expect(result.awardedPots).toBe(60n);
    expect(result.refundedUncalled).toBe(30n);
    expect(result.players.find((entry) => entry.playerId === 'bob')).toMatchObject({
      potAward: 60n,
      uncalledRefund: 30n,
      endingStack: 130n,
    });
  });

  it('is deterministic by seat and does not mutate caller input', () => {
    const input = [
      player('bob', 8, 80n, 20n, true),
      player('alice', 2, 90n, 10n, false),
    ];
    const snapshot = structuredClone(input);

    const first = resolveTerminalFold(input);
    const second = resolveTerminalFold([...input].reverse());

    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first.players.map((entry) => entry.seat)).toEqual([2, 8]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.players)).toBe(true);
    expect(first.players.every(Object.isFrozen)).toBe(true);
  });

  it('rejects non-terminal states with zero or multiple contenders', () => {
    expect(() =>
      resolveTerminalFold([
        player('alice', 0, 90n, 10n, false),
        player('bob', 1, 90n, 10n, false),
      ]),
    ).toThrow(/exactly one non-folded/i);

    expect(() =>
      resolveTerminalFold([
        player('alice', 0, 90n, 10n, true),
        player('bob', 1, 90n, 10n, true),
      ]),
    ).toThrow(/exactly one non-folded/i);
  });

  it('rejects malformed participant state through canonical pot validation', () => {
    const malformed = [
      player('alice', 0, 90n, 10n, false),
      { ...player('bob', 0, 90n, 10n, true) },
    ];

    expect(() => resolveTerminalFold(malformed)).toThrow(/duplicate seat/i);
  });

  it('preserves bigint precision and CHIP conservation', () => {
    const huge = 9_000_000_000_000_000_000n;
    const result = resolveTerminalFold([
      player('alice', 0, huge, huge, false),
      player('bob', 1, huge, huge, true),
    ]);

    expect(result.awardedPots).toBe(huge * 2n);
    expect(result.totalChips).toBe(huge * 4n);
    expect(result.players.reduce((sum, entry) => sum + entry.endingStack, 0n)).toBe(huge * 4n);
  });
});
