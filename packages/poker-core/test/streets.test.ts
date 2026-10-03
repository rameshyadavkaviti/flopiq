import { describe, expect, it } from 'vitest';

import { createBettingRoundState } from '../src/state.js';
import { createNextStreetBettingRound, type PokerStreet } from '../src/streets.js';
import { player } from './helpers.js';

const completedRound = () =>
  createBettingRoundState({
    players: [
      player({
        id: 'alice',
        seat: 0,
        stack: 80n,
        streetCommitted: 20n,
        handCommitted: 20n,
        actedSinceLastFullRaise: true,
      }),
      player({
        id: 'bob',
        seat: 4,
        stack: 80n,
        streetCommitted: 20n,
        handCommitted: 20n,
        actedSinceLastFullRaise: true,
      }),
    ],
    actingSeat: null,
    currentBet: 20n,
    minimumBet: 10n,
    minimumRaise: 10n,
    lastFullRaise: 10n,
    actionSequence: 2,
  });

describe('street progression', () => {
  it('exposes the four canonical Hold’em streets', () => {
    const streets: readonly PokerStreet[] = ['preflop', 'flop', 'turn', 'river'];

    expect(streets).toHaveLength(4);
  });

  it('resets street-only betting state while preserving hand accounting', () => {
    const previous = completedRound();

    const next = createNextStreetBettingRound(previous, 4);

    expect(next.actingSeat).toBe(4);
    expect(next.currentBet).toBe(0n);
    expect(next.minimumBet).toBe(10n);
    expect(next.minimumRaise).toBe(10n);
    expect(next.lastFullRaise).toBe(10n);
    expect(next.actionSequence).toBe(0);
    expect(next.status).toBe('active');
    expect(next.totalChips).toBe(200n);
    expect(next.players).toEqual([
      {
        id: 'alice',
        seat: 0,
        stack: 80n,
        streetCommitted: 0n,
        handCommitted: 20n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
      {
        id: 'bob',
        seat: 4,
        stack: 80n,
        streetCommitted: 0n,
        handCommitted: 20n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
    ]);
  });

  it('uses the big blind as the heads-up postflop first actor', () => {
    const next = createNextStreetBettingRound(completedRound(), 4);

    expect(next.actingSeat).toBe(4);
  });

  it('skips folded and all-in players clockwise from the requested first seat', () => {
    const previous = createBettingRoundState({
      players: [
        player({
          id: 'alice',
          seat: 1,
          stack: 80n,
          streetCommitted: 20n,
          handCommitted: 20n,
          actedSinceLastFullRaise: true,
        }),
        player({
          id: 'bob',
          seat: 3,
          stack: 80n,
          streetCommitted: 20n,
          handCommitted: 20n,
          folded: true,
          actedSinceLastFullRaise: true,
        }),
        player({
          id: 'carol',
          seat: 6,
          stack: 0n,
          streetCommitted: 20n,
          handCommitted: 100n,
          allIn: true,
          actedSinceLastFullRaise: true,
        }),
        player({
          id: 'dave',
          seat: 8,
          stack: 80n,
          streetCommitted: 20n,
          handCommitted: 20n,
          actedSinceLastFullRaise: true,
        }),
      ],
      actingSeat: null,
      currentBet: 20n,
      minimumBet: 10n,
      minimumRaise: 10n,
      lastFullRaise: 10n,
    });

    const next = createNextStreetBettingRound(previous, 3);

    expect(next.actingSeat).toBe(8);
    expect(next.players.find((candidate) => candidate.id === 'bob')?.folded).toBe(true);
    expect(next.players.find((candidate) => candidate.id === 'carol')?.allIn).toBe(true);
  });

  it('completes automatically when fewer than two contenders can act', () => {
    const previous = createBettingRoundState({
      players: [
        player({
          id: 'alice',
          seat: 0,
          stack: 80n,
          streetCommitted: 20n,
          handCommitted: 20n,
          actedSinceLastFullRaise: true,
        }),
        player({
          id: 'bob',
          seat: 4,
          stack: 0n,
          streetCommitted: 20n,
          handCommitted: 100n,
          allIn: true,
          actedSinceLastFullRaise: true,
        }),
      ],
      actingSeat: null,
      currentBet: 20n,
      minimumBet: 10n,
      minimumRaise: 10n,
      lastFullRaise: 10n,
    });

    const next = createNextStreetBettingRound(previous, 4);

    expect(next.status).toBe('complete');
    expect(next.actingSeat).toBeNull();
    expect(next.totalChips).toBe(previous.totalChips);
  });

  it('does not mutate the completed round', () => {
    const previous = completedRound();
    const snapshot = {
      ...previous,
      players: previous.players.map((candidate) => ({ ...candidate })),
    };

    createNextStreetBettingRound(previous, 4);

    expect(previous).toEqual(snapshot);
  });

  it('rejects incomplete rounds and invalid first-to-act seats', () => {
    const active = createBettingRoundState({
      players: [
        player({ id: 'alice', seat: 0 }),
        player({ id: 'bob', seat: 4 }),
      ],
      actingSeat: 0,
      currentBet: 0n,
      minimumBet: 10n,
      minimumRaise: 10n,
      lastFullRaise: 10n,
    });

    expect(() => createNextStreetBettingRound(active, 4)).toThrow(/complete/i);
    expect(() => createNextStreetBettingRound(completedRound(), 9)).toThrow(/seat/i);
    expect(() => createNextStreetBettingRound(completedRound(), 2)).toThrow(/participant/i);
  });
});
