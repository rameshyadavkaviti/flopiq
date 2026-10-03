import { describe, expect, it } from 'vitest';

import { createPreflopBettingRound } from '../src/preflop.js';

describe('preflop betting round initialization', () => {
  it('posts heads-up blinds and gives the button first action', () => {
    const state = createPreflopBettingRound({
      players: [
        { id: 'alice', seat: 0, stack: 100n },
        { id: 'bob', seat: 1, stack: 100n },
      ],
      buttonSeat: 0,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    expect(state.actingSeat).toBe(0);
    expect(state.currentBet).toBe(10n);
    expect(state.minimumBet).toBe(10n);
    expect(state.players).toEqual([
      {
        id: 'alice',
        seat: 0,
        stack: 95n,
        streetCommitted: 5n,
        handCommitted: 5n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
      {
        id: 'bob',
        seat: 1,
        stack: 90n,
        streetCommitted: 10n,
        handCommitted: 10n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
    ]);
    expect(state.totalChips).toBe(200n);
  });

  it('uses clockwise preflop action order with sparse seats', () => {
    const state = createPreflopBettingRound({
      players: [
        { id: 'alice', seat: 1, stack: 100n },
        { id: 'bob', seat: 4, stack: 100n },
        { id: 'carol', seat: 8, stack: 100n },
      ],
      buttonSeat: 8,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    expect(state.actingSeat).toBe(8);
    expect(state.players.find((player) => player.seat === 1)?.streetCommitted).toBe(5n);
    expect(state.players.find((player) => player.seat === 4)?.streetCommitted).toBe(10n);
  });

  it('supports a full blind that consumes the blind poster stack', () => {
    const state = createPreflopBettingRound({
      players: [
        { id: 'alice', seat: 0, stack: 100n },
        { id: 'bob', seat: 1, stack: 10n },
        { id: 'carol', seat: 2, stack: 100n },
      ],
      buttonSeat: 2,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    const bigBlind = state.players.find((player) => player.seat === 1);
    expect(bigBlind?.stack).toBe(0n);
    expect(bigBlind?.allIn).toBe(true);
    expect(state.actingSeat).toBe(2);
  });

  it('rejects malformed blind structures and short forced blinds for now', () => {
    const players = [
      { id: 'alice', seat: 0, stack: 100n },
      { id: 'bob', seat: 1, stack: 4n },
    ];

    expect(() =>
      createPreflopBettingRound({
        players,
        buttonSeat: 0,
        smallBlind: 5n,
        bigBlind: 10n,
      }),
    ).toThrow(/short blind/i);

    expect(() =>
      createPreflopBettingRound({
        players: [
          { id: 'alice', seat: 0, stack: 100n },
          { id: 'bob', seat: 1, stack: 100n },
        ],
        buttonSeat: 0,
        smallBlind: 10n,
        bigBlind: 10n,
      }),
    ).toThrow(/small blind/i);
  });

  it('does not mutate caller-owned player input', () => {
    const players = [
      { id: 'alice', seat: 0, stack: 100n },
      { id: 'bob', seat: 1, stack: 100n },
    ];

    createPreflopBettingRound({
      players,
      buttonSeat: 0,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    expect(players).toEqual([
      { id: 'alice', seat: 0, stack: 100n },
      { id: 'bob', seat: 1, stack: 100n },
    ]);
  });
});
