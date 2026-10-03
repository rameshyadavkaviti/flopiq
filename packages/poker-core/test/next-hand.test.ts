import { describe, expect, it } from 'vitest';

import {
  advanceHandAfterDeal,
  createHand,
  reduceHandAction,
  resolveHandShowdown,
  type HandState,
} from '../src/hand.js';
import { createNextHand } from '../src/next-hand.js';
import type { HandRank } from '../src/hand-ranking.js';

const rank = (category: HandRank['category'], tiebreak: readonly number[]): HandRank => ({
  category,
  tiebreak,
});

const completeHeadsUpFold = (): HandState => {
  const hand = createHand({
    players: [
      { id: 'alice', seat: 0, stack: 100n },
      { id: 'bob', seat: 4, stack: 100n },
    ],
    buttonSeat: 0,
    smallBlind: 5n,
    bigBlind: 10n,
  });
  return reduceHandAction(hand, { type: 'fold', playerId: 'alice' }).state;
};

const completeThreeWayAllIn = (): HandState => {
  let hand = createHand({
    players: [
      { id: 'alice', seat: 0, stack: 50n },
      { id: 'bob', seat: 1, stack: 100n },
      { id: 'carol', seat: 2, stack: 100n },
    ],
    buttonSeat: 2,
    smallBlind: 5n,
    bigBlind: 10n,
  });

  hand = reduceHandAction(hand, { type: 'all-in', playerId: 'carol' }).state;
  hand = reduceHandAction(hand, { type: 'call', playerId: 'alice' }).state;
  hand = reduceHandAction(hand, { type: 'call', playerId: 'bob' }).state;
  hand = advanceHandAfterDeal(hand, 'flop');
  hand = advanceHandAfterDeal(hand, 'turn');
  hand = advanceHandAfterDeal(hand, 'river');

  return resolveHandShowdown(hand, [
    { playerId: 'alice', rank: rank('straight-flush', [9]) },
    { playerId: 'bob', rank: rank('straight', [10]) },
    { playerId: 'carol', rank: rank('one-pair', [14, 13, 12, 11]) },
  ]);
};

describe('next-hand progression', () => {
  it('carries ending stacks forward and rotates the heads-up button', () => {
    const previous = completeHeadsUpFold();
    const next = createNextHand(previous);

    expect(next.phase).toBe('betting');
    expect(next.street).toBe('preflop');
    expect(next.buttonSeat).toBe(4);
    expect(next.positions).toEqual({
      buttonSeat: 4,
      smallBlindSeat: 4,
      bigBlindSeat: 0,
      preflopFirstSeat: 4,
      postflopFirstSeat: 0,
    });
    expect(next.betting.players).toEqual([
      {
        id: 'alice',
        seat: 0,
        stack: 85n,
        streetCommitted: 10n,
        handCommitted: 10n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
      {
        id: 'bob',
        seat: 4,
        stack: 100n,
        streetCommitted: 5n,
        handCommitted: 5n,
        folded: false,
        allIn: false,
        actedSinceLastFullRaise: false,
      },
    ]);
    expect(next.betting.totalChips).toBe(200n);
  });

  it('removes zero-stack players and rotates to the next occupied seat', () => {
    const previous = completeThreeWayAllIn();
    if (previous.completion?.type !== 'showdown') throw new Error('Expected showdown completion');
    expect(previous.completion.settlement.players.map((player) => player.endingStack)).toEqual([
      150n,
      100n,
      0n,
    ]);

    const next = createNextHand(previous);

    expect(next.buttonSeat).toBe(0);
    expect(next.betting.players.map((player) => player.id)).toEqual(['alice', 'bob']);
    expect(next.betting.players.map((player) => player.stack)).toEqual([145n, 90n]);
    expect(next.betting.totalChips).toBe(250n);
  });

  it('does not mutate the completed hand while constructing the next hand', () => {
    const previous = completeHeadsUpFold();
    const snapshot = previous;

    const next = createNextHand(previous);

    expect(previous).toBe(snapshot);
    expect(previous.phase).toBe('complete');
    expect(next).not.toBe(previous);
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('rejects progression before the current hand is complete', () => {
    const active = createHand({
      players: [
        { id: 'alice', seat: 0, stack: 100n },
        { id: 'bob', seat: 4, stack: 100n },
      ],
      buttonSeat: 0,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    expect(() => createNextHand(active)).toThrow(/completed hand/i);
  });

  it('stops when fewer than two players have CHIP for another hand', () => {
    let hand = createHand({
      players: [
        { id: 'alice', seat: 0, stack: 100n },
        { id: 'bob', seat: 4, stack: 100n },
      ],
      buttonSeat: 0,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    hand = reduceHandAction(hand, { type: 'all-in', playerId: 'alice' }).state;
    hand = reduceHandAction(hand, { type: 'call', playerId: 'bob' }).state;
    hand = advanceHandAfterDeal(hand, 'flop');
    hand = advanceHandAfterDeal(hand, 'turn');
    hand = advanceHandAfterDeal(hand, 'river');
    hand = resolveHandShowdown(hand, [
      { playerId: 'alice', rank: rank('straight-flush', [9]) },
      { playerId: 'bob', rank: rank('straight', [10]) },
    ]);

    expect(() => createNextHand(hand)).toThrow(/at least two players/i);
  });
});
