import { describe, expect, it } from 'vitest';

import { reduceBettingAction } from '../src/betting.js';
import { findPlayer, makeState, player } from './helpers.js';

const stateBeforeAllIn = (allInStack: bigint) =>
  makeState({
    players: [
      player({
        id: 'alice',
        seat: 0,
        stack: 80n,
        streetCommitted: 20n,
        actedSinceLastFullRaise: true,
      }),
      player({
        id: 'bob',
        seat: 1,
        stack: 80n,
        streetCommitted: 20n,
        actedSinceLastFullRaise: true,
      }),
      player({ id: 'carol', seat: 2, stack: allInStack }),
    ],
    actingSeat: 2,
    currentBet: 20n,
    minimumRaise: 20n,
  });

describe('all-in raise reopening rules', () => {
  it('accepts a short all-in raise without reopening action for prior actors', () => {
    const result = reduceBettingAction(stateBeforeAllIn(25n), {
      type: 'all-in',
      playerId: 'carol',
    });

    expect(result.state.currentBet).toBe(25n);
    expect(result.state.minimumRaise).toBe(20n);
    expect(result.state.lastFullRaise).toBe(20n);
    expect(findPlayer(result.state, 'alice').actedSinceLastFullRaise).toBe(true);
    expect(findPlayer(result.state, 'bob').actedSinceLastFullRaise).toBe(true);
    expect(result.events).toEqual([
      {
        type: 'PLAYER_RAISED',
        playerId: 'carol',
        seat: 2,
        amount: 25n,
        toAmount: 25n,
        raiseSize: 5n,
        fullRaise: false,
      },
      {
        type: 'PLAYER_ALL_IN',
        playerId: 'carol',
        seat: 2,
        kind: 'raise',
        toAmount: 25n,
      },
    ]);

    expect(() =>
      reduceBettingAction(result.state, { type: 'raise', playerId: 'alice', to: 45n }),
    ).toThrow(/not reopened/i);

    const aliceCalls = reduceBettingAction(result.state, { type: 'call', playerId: 'alice' });
    const bobCalls = reduceBettingAction(aliceCalls.state, { type: 'call', playerId: 'bob' });
    expect(bobCalls.state.status).toBe('complete');
  });

  it('reopens action after a full all-in raise', () => {
    const result = reduceBettingAction(stateBeforeAllIn(40n), {
      type: 'all-in',
      playerId: 'carol',
    });

    expect(result.state.currentBet).toBe(40n);
    expect(findPlayer(result.state, 'alice').actedSinceLastFullRaise).toBe(false);
    expect(findPlayer(result.state, 'bob').actedSinceLastFullRaise).toBe(false);

    const reraised = reduceBettingAction(result.state, {
      type: 'raise',
      playerId: 'alice',
      to: 60n,
    });
    expect(reraised.state.currentBet).toBe(60n);
    expect(reraised.events[0]).toMatchObject({ type: 'PLAYER_RAISED', fullRaise: true });
  });

  it('reopens action when cumulative short all-ins equal a full raise', () => {
    let state = makeState({
      players: [
        player({ id: 'alice', seat: 0 }),
        player({ id: 'bob', seat: 1 }),
        player({ id: 'carol', seat: 2, stack: 25n }),
        player({ id: 'dave', seat: 3, stack: 30n }),
        player({ id: 'erin', seat: 4, stack: 40n }),
      ],
    });

    state = reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: 20n }).state;
    state = reduceBettingAction(state, { type: 'call', playerId: 'bob' }).state;
    state = reduceBettingAction(state, { type: 'all-in', playerId: 'carol' }).state;
    state = reduceBettingAction(state, { type: 'all-in', playerId: 'dave' }).state;
    state = reduceBettingAction(state, { type: 'all-in', playerId: 'erin' }).state;

    expect(state.currentBet).toBe(40n);
    expect(state.minimumRaise).toBe(20n);
    expect(findPlayer(state, 'alice').actedSinceLastFullRaise).toBe(false);
    expect(findPlayer(state, 'bob').actedSinceLastFullRaise).toBe(false);

    const reraised = reduceBettingAction(state, {
      type: 'raise',
      playerId: 'alice',
      to: 60n,
    });
    expect(reraised.state.currentBet).toBe(60n);
  });

  it('treats an all-in below the call as an all-in call, not a raise', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 5n, streetCommitted: 10n }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
        player({ id: 'carol', seat: 2 }),
      ],
      currentBet: 20n,
    });
    const result = reduceBettingAction(state, { type: 'all-in', playerId: 'alice' });

    expect(result.state.currentBet).toBe(20n);
    expect(findPlayer(result.state, 'alice').streetCommitted).toBe(15n);
    expect(result.events).toEqual([
      { type: 'PLAYER_CALLED', playerId: 'alice', seat: 0, amount: 5n, toAmount: 15n },
      { type: 'PLAYER_ALL_IN', playerId: 'alice', seat: 0, kind: 'call', toAmount: 15n },
    ]);
  });

  it('allows a full all-in opening bet and a short all-in opening bet', () => {
    const full = reduceBettingAction(
      makeState({ players: [player({ id: 'alice', seat: 0, stack: 20n }), player({ id: 'bob', seat: 1 })] }),
      { type: 'all-in', playerId: 'alice' },
    );
    expect(full.state.currentBet).toBe(20n);
    expect(full.state.lastFullRaise).toBe(20n);
    expect(full.events[0]).toEqual({
      type: 'PLAYER_BET',
      playerId: 'alice',
      seat: 0,
      amount: 20n,
    });

    const short = reduceBettingAction(
      makeState({ players: [player({ id: 'alice', seat: 0, stack: 12n }), player({ id: 'bob', seat: 1 })] }),
      { type: 'all-in', playerId: 'alice' },
    );
    expect(short.state.currentBet).toBe(12n);
    expect(short.state.minimumRaise).toBe(20n);
    expect(short.events[0]).toEqual({
      type: 'PLAYER_BET',
      playerId: 'alice',
      seat: 0,
      amount: 12n,
    });
  });
});
