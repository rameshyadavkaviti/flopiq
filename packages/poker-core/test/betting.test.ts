import { describe, expect, it } from 'vitest';

import { reduceBettingAction } from '../src/betting.js';
import { findPlayer, makeState, player } from './helpers.js';

describe('betting reducer', () => {
  it('folds the actor and advances deterministically', () => {
    const state = makeState();
    const result = reduceBettingAction(state, { type: 'fold', playerId: 'alice' });

    expect(findPlayer(result.state, 'alice').folded).toBe(true);
    expect(result.state.actingSeat).toBe(1);
    expect(result.state.actionSequence).toBe(1);
    expect(result.events).toEqual([{ type: 'PLAYER_FOLDED', playerId: 'alice', seat: 0 }]);
  });

  it('checks only when the actor has matched the current bet', () => {
    const checked = reduceBettingAction(makeState(), { type: 'check', playerId: 'alice' });
    expect(checked.state.actingSeat).toBe(1);
    expect(checked.events).toEqual([{ type: 'PLAYER_CHECKED', playerId: 'alice', seat: 0 }]);

    const facingBet = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 90n, streetCommitted: 10n }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
      ],
      actingSeat: 0,
      currentBet: 20n,
    });
    expect(() =>
      reduceBettingAction(facingBet, { type: 'check', playerId: 'alice' }),
    ).toThrow(/cannot check/i);
  });

  it('calls the exact amount required', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 90n, streetCommitted: 10n }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
        player({ id: 'carol', seat: 2 }),
      ],
      currentBet: 20n,
    });
    const result = reduceBettingAction(state, { type: 'call', playerId: 'alice' });
    const alice = findPlayer(result.state, 'alice');

    expect(alice.stack).toBe(80n);
    expect(alice.streetCommitted).toBe(20n);
    expect(alice.handCommitted).toBe(20n);
    expect(result.events).toEqual([
      { type: 'PLAYER_CALLED', playerId: 'alice', seat: 0, amount: 10n, toAmount: 20n },
    ]);
  });

  it('allows an exact-stack all-in call', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 10n, streetCommitted: 10n }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
        player({ id: 'carol', seat: 2 }),
      ],
      currentBet: 20n,
    });
    const result = reduceBettingAction(state, { type: 'call', playerId: 'alice' });
    const alice = findPlayer(result.state, 'alice');

    expect(alice.stack).toBe(0n);
    expect(alice.allIn).toBe(true);
    expect(result.events).toEqual([
      { type: 'PLAYER_CALLED', playerId: 'alice', seat: 0, amount: 10n, toAmount: 20n },
      { type: 'PLAYER_ALL_IN', playerId: 'alice', seat: 0, kind: 'call', toAmount: 20n },
    ]);
  });

  it('rejects a call when there is nothing to call', () => {
    expect(() =>
      reduceBettingAction(makeState(), { type: 'call', playerId: 'alice' }),
    ).toThrow(/nothing to call/i);
  });

  it('accepts a minimum bet and rejects undersized or unaffordable bets', () => {
    const state = makeState();
    const result = reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: 20n });
    const alice = findPlayer(result.state, 'alice');

    expect(alice.stack).toBe(80n);
    expect(alice.streetCommitted).toBe(20n);
    expect(result.state.currentBet).toBe(20n);
    expect(result.state.minimumRaise).toBe(20n);
    expect(result.events).toEqual([
      { type: 'PLAYER_BET', playerId: 'alice', seat: 0, amount: 20n },
    ]);
    expect(() =>
      reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: 19n }),
    ).toThrow(/minimum bet/i);
    expect(() =>
      reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: 101n }),
    ).toThrow(/insufficient stack/i);
  });

  it('accepts a minimum raise-to amount and rejects undersized raises', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 80n, streetCommitted: 20n }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
        player({ id: 'carol', seat: 2 }),
      ],
      currentBet: 20n,
    });
    const result = reduceBettingAction(state, { type: 'raise', playerId: 'alice', to: 40n });
    const alice = findPlayer(result.state, 'alice');

    expect(alice.stack).toBe(60n);
    expect(alice.streetCommitted).toBe(40n);
    expect(result.state.currentBet).toBe(40n);
    expect(result.state.lastFullRaise).toBe(20n);
    expect(result.events).toEqual([
      {
        type: 'PLAYER_RAISED',
        playerId: 'alice',
        seat: 0,
        amount: 20n,
        toAmount: 40n,
        raiseSize: 20n,
        fullRaise: true,
      },
    ]);
    expect(() =>
      reduceBettingAction(state, { type: 'raise', playerId: 'alice', to: 39n }),
    ).toThrow(/minimum raise/i);
  });

  it('rejects actions from anyone except the current actor', () => {
    const state = makeState();
    expect(() =>
      reduceBettingAction(state, { type: 'fold', playerId: 'bob' }),
    ).toThrow(/current actor/i);
  });

  it('skips folded and all-in players when choosing the next actor', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0 }),
        player({ id: 'bob', seat: 1, folded: true }),
        player({ id: 'carol', seat: 2, stack: 0n, allIn: true }),
        player({ id: 'dave', seat: 3 }),
      ],
    });

    const result = reduceBettingAction(state, { type: 'check', playerId: 'alice' });
    expect(result.state.actingSeat).toBe(3);
  });

  it('wraps deterministic action order by seat number', () => {
    const state = makeState({ actingSeat: 2 });
    const result = reduceBettingAction(state, { type: 'check', playerId: 'carol' });
    expect(result.state.actingSeat).toBe(0);
  });

  it('completes the round when every actionable player has acted and matched', () => {
    const state = makeState({
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
        player({ id: 'carol', seat: 2, stack: 80n, streetCommitted: 20n }),
      ],
      actingSeat: 2,
      currentBet: 20n,
    });
    const result = reduceBettingAction(state, { type: 'check', playerId: 'carol' });

    expect(result.state.status).toBe('complete');
    expect(result.state.actingSeat).toBeNull();
    expect(result.events.at(-1)).toEqual({
      type: 'BETTING_ROUND_COMPLETE',
      actionSequence: 1,
    });
  });

  it('finishes immediately when a fold leaves one player', () => {
    const state = makeState({
      players: [player({ id: 'alice', seat: 0 }), player({ id: 'bob', seat: 1 })],
    });
    const result = reduceBettingAction(state, { type: 'fold', playerId: 'alice' });

    expect(result.state.status).toBe('complete');
    expect(result.events.at(-1)?.type).toBe('BETTING_ROUND_COMPLETE');
  });

  it('completes when the sole player with chips has matched the all-in wager', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 0n, streetCommitted: 20n, allIn: true }),
        player({ id: 'bob', seat: 1, stack: 80n, streetCommitted: 20n }),
        player({ id: 'carol', seat: 2, stack: 80n, streetCommitted: 20n }),
      ],
      actingSeat: 2,
      currentBet: 20n,
    });

    const result = reduceBettingAction(state, { type: 'fold', playerId: 'carol' });
    expect(result.state.status).toBe('complete');
    expect(result.state.actingSeat).toBeNull();
  });

  it('requires the sole player with chips to act when they still owe CHIP', () => {
    const state = makeState({
      players: [
        player({ id: 'alice', seat: 0, stack: 0n, streetCommitted: 20n, allIn: true }),
        player({ id: 'bob', seat: 1, stack: 90n, streetCommitted: 10n }),
        player({ id: 'carol', seat: 2, stack: 80n, streetCommitted: 20n }),
      ],
      actingSeat: 2,
      currentBet: 20n,
    });

    const result = reduceBettingAction(state, { type: 'fold', playerId: 'carol' });
    expect(result.state.status).toBe('active');
    expect(result.state.actingSeat).toBe(1);
  });

  it('rejects malformed and negative action amounts', () => {
    const state = makeState();
    expect(() =>
      reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: -1n }),
    ).toThrow(/nonnegative/i);
    expect(() =>
      reduceBettingAction(state, {
        type: 'bet',
        playerId: 'alice',
        amount: 20 as never,
      }),
    ).toThrow(/bigint/i);
  });

  it('does not mutate state when rejecting an action', () => {
    const state = makeState();
    const before = { ...state, players: state.players.map((current) => ({ ...current })) };

    expect(() =>
      reduceBettingAction(state, { type: 'bet', playerId: 'alice', amount: 1n }),
    ).toThrow();
    expect(state).toEqual(before);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players[0])).toBe(true);
  });

  it('returns identical output for identical state and action', () => {
    const state = makeState();
    const action = { type: 'bet', playerId: 'alice', amount: 20n } as const;

    expect(reduceBettingAction(state, action)).toEqual(reduceBettingAction(state, action));
  });
});
