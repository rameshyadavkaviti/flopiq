import { describe, expect, it } from 'vitest';

import { createStandardDeck, type Card } from '../src/cards.js';
import {
  createLocalDealer,
  revealFlop,
  revealRiver,
  revealTurn,
} from '../src/dealer.js';
import {
  advanceHandAfterDeal,
  createHand,
  reduceHandAction,
  resolveHandShowdown,
} from '../src/hand.js';
import {
  evaluateTexasHoldemHand,
  type HandRank,
} from '../src/hand-ranking.js';

const deckWithPrefix = (prefix: readonly Card[]): readonly Card[] => {
  const prefixSet = new Set(prefix);
  return [...prefix, ...createStandardDeck().filter((card) => !prefixSet.has(card))];
};

const scriptedDeck = deckWithPrefix([
  'As',
  'Ks',
  'Qs',
  'Js',
  'Ts',
  '9s',
  '8s',
  '7s',
  '6s',
  '5s',
  '4s',
  '3s',
]);

const players = [
  { id: 'alice', seat: 0, stack: 100n },
  { id: 'bob', seat: 4, stack: 100n },
] as const;

const startHand = () =>
  createHand({
    players,
    buttonSeat: 0,
    smallBlind: 5n,
    bigBlind: 10n,
  });

const rank = (category: HandRank['category'], tiebreak: readonly number[]): HandRank => ({
  category,
  tiebreak,
});

describe('hand lifecycle', () => {
  it('starts heads-up preflop with canonical positions and blinds', () => {
    const state = createHand({
      players: [...players].reverse(),
      buttonSeat: 0,
      smallBlind: 5n,
      bigBlind: 10n,
    });

    expect(state.phase).toBe('betting');
    expect(state.street).toBe('preflop');
    expect(state.positions).toEqual({
      buttonSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 4,
      preflopFirstSeat: 0,
      postflopFirstSeat: 4,
    });
    expect(state.betting.actingSeat).toBe(0);
    expect(state.betting.players.map((player) => player.id)).toEqual(['alice', 'bob']);
    expect(state.betting.totalChips).toBe(200n);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('completes immediately and conserves CHIP when a preflop fold leaves one player', () => {
    const initial = startHand();
    const snapshot = {
      ...initial,
      betting: {
        ...initial.betting,
        players: initial.betting.players.map((player) => ({ ...player })),
      },
    };

    const result = reduceHandAction(initial, { type: 'fold', playerId: 'alice' });

    expect(initial).toEqual(snapshot);
    expect(result.state.phase).toBe('complete');
    expect(result.state.completion?.type).toBe('fold');
    if (result.state.completion?.type !== 'fold') throw new Error('Expected fold completion');

    expect(result.state.completion.settlement.winnerId).toBe('bob');
    expect(result.state.completion.settlement.awardedPots).toBe(10n);
    expect(result.state.completion.settlement.refundedUncalled).toBe(5n);
    expect(
      result.state.completion.settlement.players.find((player) => player.playerId === 'bob')
        ?.endingStack,
    ).toBe(105n);
    expect(result.state.completion.settlement.totalChips).toBe(200n);
    expect(() =>
      reduceHandAction(result.state, { type: 'check', playerId: 'bob' }),
    ).toThrow(/complete/i);
  });

  it('coordinates a full checked-down hand with the replaceable local dealer and resolves showdown', () => {
    let hand = startHand();
    let dealer = createLocalDealer({
      deck: scriptedDeck,
      players,
      buttonSeat: 0,
    });

    hand = reduceHandAction(hand, { type: 'call', playerId: 'alice' }).state;
    hand = reduceHandAction(hand, { type: 'check', playerId: 'bob' }).state;
    expect(hand.phase).toBe('awaiting-next-street');

    dealer = revealFlop(dealer);
    expect(dealer.street).toBe('flop');
    hand = advanceHandAfterDeal(hand, 'flop');
    expect(hand.betting.actingSeat).toBe(4);

    hand = reduceHandAction(hand, { type: 'check', playerId: 'bob' }).state;
    hand = reduceHandAction(hand, { type: 'check', playerId: 'alice' }).state;
    dealer = revealTurn(dealer);
    hand = advanceHandAfterDeal(hand, 'turn');

    hand = reduceHandAction(hand, { type: 'check', playerId: 'bob' }).state;
    hand = reduceHandAction(hand, { type: 'check', playerId: 'alice' }).state;
    dealer = revealRiver(dealer);
    hand = advanceHandAfterDeal(hand, 'river');

    hand = reduceHandAction(hand, { type: 'check', playerId: 'bob' }).state;
    hand = reduceHandAction(hand, { type: 'check', playerId: 'alice' }).state;
    expect(hand.phase).toBe('awaiting-showdown');

    if (dealer.board.length !== 5) throw new Error('Expected a complete board');
    const board = dealer.board as readonly [Card, Card, Card, Card, Card];
    const rankedPlayers = dealer.holeCards.map((entry) => ({
      playerId: entry.playerId,
      rank: evaluateTexasHoldemHand(entry.cards, board),
    }));

    hand = resolveHandShowdown(hand, rankedPlayers);

    expect(hand.phase).toBe('complete');
    expect(hand.street).toBe('river');
    expect(hand.completion?.type).toBe('showdown');
    if (hand.completion?.type !== 'showdown') throw new Error('Expected showdown completion');

    expect(hand.completion.winners).toEqual([{ potIndex: 0, winnerIds: ['bob'] }]);
    expect(
      hand.completion.settlement.players.find((player) => player.playerId === 'alice')
        ?.endingStack,
    ).toBe(90n);
    expect(
      hand.completion.settlement.players.find((player) => player.playerId === 'bob')
        ?.endingStack,
    ).toBe(110n);
    expect(hand.completion.settlement.totalChips).toBe(200n);
  });

  it('runs all-in betting streets without inventing extra player decisions', () => {
    let hand = startHand();

    hand = reduceHandAction(hand, { type: 'all-in', playerId: 'alice' }).state;
    hand = reduceHandAction(hand, { type: 'call', playerId: 'bob' }).state;

    expect(hand.phase).toBe('awaiting-next-street');
    expect(hand.betting.players.every((player) => player.allIn)).toBe(true);

    hand = advanceHandAfterDeal(hand, 'flop');
    expect(hand.phase).toBe('awaiting-next-street');
    expect(hand.betting.status).toBe('complete');

    hand = advanceHandAfterDeal(hand, 'turn');
    expect(hand.phase).toBe('awaiting-next-street');

    hand = advanceHandAfterDeal(hand, 'river');
    expect(hand.phase).toBe('awaiting-showdown');

    hand = resolveHandShowdown(hand, [
      { playerId: 'alice', rank: rank('straight', [9]) },
      { playerId: 'bob', rank: rank('straight', [9]) },
    ]);

    expect(hand.completion?.type).toBe('showdown');
    if (hand.completion?.type !== 'showdown') throw new Error('Expected showdown completion');
    expect(hand.completion.settlement.players.map((player) => player.endingStack)).toEqual([
      100n,
      100n,
    ]);
    expect(hand.completion.settlement.totalChips).toBe(200n);
  });

  it('carries multiple all-ins through showdown and settles main and side pots', () => {
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

    expect(hand.phase).toBe('awaiting-next-street');
    hand = advanceHandAfterDeal(hand, 'flop');
    hand = advanceHandAfterDeal(hand, 'turn');
    hand = advanceHandAfterDeal(hand, 'river');

    hand = resolveHandShowdown(hand, [
      { playerId: 'carol', rank: rank('one-pair', [14, 13, 12, 11]) },
      { playerId: 'alice', rank: rank('straight-flush', [9]) },
      { playerId: 'bob', rank: rank('straight', [10]) },
    ]);

    expect(hand.completion?.type).toBe('showdown');
    if (hand.completion?.type !== 'showdown') throw new Error('Expected showdown completion');
    expect(hand.completion.winners).toEqual([
      { potIndex: 0, winnerIds: ['alice'] },
      { potIndex: 1, winnerIds: ['bob'] },
    ]);
    expect(hand.completion.settlement.pots.map((pot) => pot.amount)).toEqual([150n, 100n]);
    expect(hand.completion.settlement.players.map((player) => player.endingStack)).toEqual([
      150n,
      100n,
      0n,
    ]);
    expect(hand.completion.settlement.totalChips).toBe(250n);
  });

  it('keeps dealer progression explicit and rejects out-of-order lifecycle transitions', () => {
    let hand = startHand();

    expect(() => advanceHandAfterDeal(hand, 'flop')).toThrow(/awaiting/i);
    expect(() =>
      resolveHandShowdown(hand, [
        { playerId: 'alice', rank: rank('straight', [9]) },
        { playerId: 'bob', rank: rank('straight', [9]) },
      ]),
    ).toThrow(/not ready/i);

    hand = reduceHandAction(hand, { type: 'call', playerId: 'alice' }).state;
    hand = reduceHandAction(hand, { type: 'check', playerId: 'bob' }).state;
    const snapshot = hand;

    expect(() => advanceHandAfterDeal(hand, 'turn')).toThrow(/flop/i);
    expect(hand).toBe(snapshot);
    expect(() =>
      reduceHandAction(hand, { type: 'check', playerId: 'bob' }),
    ).toThrow(/not accepting/i);
  });

  it('rejects missing, duplicate, extra, and malformed showdown ranks', () => {
    let hand = startHand();
    hand = reduceHandAction(hand, { type: 'all-in', playerId: 'alice' }).state;
    hand = reduceHandAction(hand, { type: 'call', playerId: 'bob' }).state;
    hand = advanceHandAfterDeal(hand, 'flop');
    hand = advanceHandAfterDeal(hand, 'turn');
    hand = advanceHandAfterDeal(hand, 'river');

    expect(() =>
      resolveHandShowdown(hand, [{ playerId: 'alice', rank: rank('straight', [9]) }]),
    ).toThrow(/exactly one rank/i);

    expect(() =>
      resolveHandShowdown(hand, [
        { playerId: 'alice', rank: rank('straight', [9]) },
        { playerId: 'alice', rank: rank('straight', [9]) },
      ]),
    ).toThrow(/duplicate/i);

    expect(() =>
      resolveHandShowdown(hand, [
        { playerId: 'alice', rank: rank('straight', [9]) },
        { playerId: 'mallory', rank: rank('straight', [9]) },
      ]),
    ).toThrow(/missing|eligible/i);

    expect(() =>
      resolveHandShowdown(hand, [
        { playerId: 'alice', rank: rank('straight', [4]) },
        { playerId: 'bob', rank: rank('straight', [9]) },
      ]),
    ).toThrow(/invalid tiebreak/i);
  });
});
