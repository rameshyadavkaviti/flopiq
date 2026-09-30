import { describe, expect, it } from 'vitest';

import { assertBettingRoundInvariants } from '../src/invariants.js';
import { createBettingRoundState } from '../src/state.js';

const basePlayers = () => [
  {
    id: 'alice',
    seat: 0,
    stack: 90n,
    streetCommitted: 10n,
    handCommitted: 10n,
    folded: false,
    allIn: false,
    actedSinceLastFullRaise: false,
  },
  {
    id: 'bob',
    seat: 1,
    stack: 80n,
    streetCommitted: 20n,
    handCommitted: 20n,
    folded: false,
    allIn: false,
    actedSinceLastFullRaise: true,
  },
];

const playerAt = <T>(players: T[], index: number): T => {
  const player = players[index];
  if (player === undefined) throw new Error(`Missing test player at index ${index}`);
  return player;
};

describe('betting round state', () => {
  it('creates a frozen state detached from caller-owned input', () => {
    const players = basePlayers();
    const state = createBettingRoundState({
      players,
      actingSeat: 0,
      currentBet: 20n,
      minimumBet: 20n,
      minimumRaise: 20n,
      lastFullRaise: 20n,
    });

    playerAt(players, 0).stack = 0n;

    expect(state.players[0]?.stack).toBe(90n);
    expect(state.totalChips).toBe(200n);
    expect(state.status).toBe('active');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players)).toBe(true);
    expect(Object.isFrozen(state.players[0])).toBe(true);
  });

  it('rejects duplicate seats and duplicate player identities', () => {
    const duplicateSeat = basePlayers();
    playerAt(duplicateSeat, 1).seat = 0;
    expect(() =>
      createBettingRoundState({
        players: duplicateSeat,
        actingSeat: 0,
        currentBet: 20n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/duplicate seat/i);

    const duplicateId = basePlayers();
    playerAt(duplicateId, 1).id = 'alice';
    expect(() =>
      createBettingRoundState({
        players: duplicateId,
        actingSeat: 0,
        currentBet: 20n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/duplicate player/i);
  });

  it('rejects an actor who is folded, all-in, or absent', () => {
    for (const actingSeat of [0, 8]) {
      const players = basePlayers();
      if (actingSeat === 0) playerAt(players, 0).folded = true;

      expect(() =>
        createBettingRoundState({
          players,
          actingSeat,
          currentBet: 20n,
          minimumBet: 20n,
          minimumRaise: 20n,
          lastFullRaise: 20n,
        }),
      ).toThrow(/acting seat/i);
    }
  });

  it('rejects negative accounting values and inconsistent commitments', () => {
    const negative = basePlayers();
    playerAt(negative, 0).stack = -1n;
    expect(() =>
      createBettingRoundState({
        players: negative,
        actingSeat: 0,
        currentBet: 20n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/nonnegative/i);

    const inconsistent = basePlayers();
    playerAt(inconsistent, 0).handCommitted = 5n;
    expect(() =>
      createBettingRoundState({
        players: inconsistent,
        actingSeat: 0,
        currentBet: 20n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/hand commitment/i);
  });

  it('returns only states that satisfy the exported invariants', () => {
    const state = createBettingRoundState({
      players: basePlayers(),
      actingSeat: 0,
      currentBet: 20n,
      minimumBet: 20n,
      minimumRaise: 20n,
      lastFullRaise: 20n,
    });
    expect(() => assertBettingRoundInvariants(state)).not.toThrow();

    const unactedPlayers = basePlayers().map((current) => ({
      ...current,
      streetCommitted: 0n,
      handCommitted: 0n,
    }));
    expect(() =>
      createBettingRoundState({
        players: unactedPlayers,
        actingSeat: null,
        currentBet: 0n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/complete round/i);

    const finishedPlayers = basePlayers().map((current) => ({
      ...current,
      streetCommitted: 0n,
      handCommitted: 0n,
      actedSinceLastFullRaise: true,
    }));
    expect(() =>
      createBettingRoundState({
        players: finishedPlayers,
        actingSeat: 0,
        currentBet: 0n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/active round/i);
  });

  it.each([
    { field: 'folded', value: 'false' },
    { field: 'folded', value: null },
    { field: 'actedSinceLastFullRaise', value: 1 },
    { field: 'actedSinceLastFullRaise', value: undefined },
  ] as const)('rejects nonboolean $field state', ({ field, value }) => {
    const players = basePlayers();
    const first = playerAt(players, 0) as unknown as Record<string, unknown>;
    first[field] = value;

    expect(() =>
      createBettingRoundState({
        players,
        actingSeat: 1,
        currentBet: 20n,
        minimumBet: 20n,
        minimumRaise: 20n,
        lastFullRaise: 20n,
      }),
    ).toThrow(/boolean/i);
  });
});
