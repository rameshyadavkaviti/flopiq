import { describe, expect, it } from 'vitest';

import type { Card } from '../src/cards.js';
import {
  compareHandRanks,
  evaluateTexasHoldemHand,
  type HandCategory,
} from '../src/hand-ranking.js';

type HoleCards = readonly [Card, Card];
type BoardCards = readonly [Card, Card, Card, Card, Card];

const rank = (holeCards: HoleCards, board: BoardCards) =>
  evaluateTexasHoldemHand(holeCards, board);

describe('Texas Hold’em hand ranking', () => {
  it.each<{
    readonly category: HandCategory;
    readonly holeCards: HoleCards;
    readonly board: BoardCards;
    readonly tiebreak: readonly number[];
  }>([
    {
      category: 'straight-flush',
      holeCards: ['As', 'Ks'],
      board: ['Qs', 'Js', 'Ts', '2d', '3c'],
      tiebreak: [14],
    },
    {
      category: 'four-of-a-kind',
      holeCards: ['Ac', 'Ad'],
      board: ['Ah', 'As', '2c', '3d', '4h'],
      tiebreak: [14, 4],
    },
    {
      category: 'full-house',
      holeCards: ['Ah', 'Ad'],
      board: ['As', 'Kc', 'Kd', '2s', '3s'],
      tiebreak: [14, 13],
    },
    {
      category: 'flush',
      holeCards: ['As', '9s'],
      board: ['7s', '5s', '2s', 'Kd', 'Qc'],
      tiebreak: [14, 9, 7, 5, 2],
    },
    {
      category: 'straight',
      holeCards: ['Ah', 'Kd'],
      board: ['Qc', 'Js', 'Td', '2s', '3d'],
      tiebreak: [14],
    },
    {
      category: 'three-of-a-kind',
      holeCards: ['Ah', 'Ad'],
      board: ['As', 'Kc', 'Qd', '2s', '3s'],
      tiebreak: [14, 13, 12],
    },
    {
      category: 'two-pair',
      holeCards: ['Ah', 'Ad'],
      board: ['Kc', 'Kd', 'Qs', '2s', '3d'],
      tiebreak: [14, 13, 12],
    },
    {
      category: 'one-pair',
      holeCards: ['Ah', 'Ad'],
      board: ['Kc', 'Qd', '9s', '2s', '3d'],
      tiebreak: [14, 13, 12, 9],
    },
    {
      category: 'high-card',
      holeCards: ['As', 'Kd'],
      board: ['Qc', '9s', '7d', '4h', '2c'],
      tiebreak: [14, 13, 12, 9, 7],
    },
  ])('ranks $category', ({ category, holeCards, board, tiebreak }) => {
    expect(rank(holeCards, board)).toEqual({ category, tiebreak });
  });

  it('recognizes an ace-low wheel straight', () => {
    expect(rank(['As', '2d'], ['3c', '4h', '5s', 'Kd', 'Qc'])).toEqual({
      category: 'straight',
      tiebreak: [5],
    });
  });

  it('uses the best five cards from all seven, including two available trips', () => {
    expect(rank(['As', 'Ah'], ['Ad', 'Ks', 'Kh', 'Kd', '2c'])).toEqual({
      category: 'full-house',
      tiebreak: [14, 13],
    });

    expect(rank(['As', '9s'], ['Ks', 'Qs', '7s', '5s', '2d'])).toEqual({
      category: 'flush',
      tiebreak: [14, 13, 12, 9, 7],
    });
  });

  it('compares category strength and exact kickers', () => {
    const straight = rank(['Ah', 'Kd'], ['Qc', 'Js', 'Td', '2s', '3d']);
    const trips = rank(['Ah', 'Ad'], ['As', 'Kc', 'Qd', '2s', '3s']);
    const pairKingKicker = rank(['Ah', 'Ad'], ['Kc', 'Qd', '9s', '2s', '3d']);
    const pairQueenKicker = rank(['Ac', 'As'], ['Qh', 'Jd', '9c', '2h', '3c']);

    expect(compareHandRanks(straight, trips)).toBe(1);
    expect(compareHandRanks(trips, straight)).toBe(-1);
    expect(compareHandRanks(pairKingKicker, pairQueenKicker)).toBe(1);
  });

  it('ties when the board is the best hand for both players', () => {
    const first = rank(['2c', '3d'], ['As', 'Ks', 'Qs', 'Js', 'Ts']);
    const second = rank(['4c', '5d'], ['As', 'Ks', 'Qs', 'Js', 'Ts']);

    expect(first).toEqual(second);
    expect(compareHandRanks(first, second)).toBe(0);
  });

  it('is deterministic regardless of card order within the private and board inputs', () => {
    const first = rank(['As', '9s'], ['Ks', 'Qs', '7s', '5s', '2d']);
    const second = rank(['9s', 'As'], ['2d', '5s', '7s', 'Qs', 'Ks']);

    expect(second).toEqual(first);
  });

  it('rejects duplicate cards and malformed card counts', () => {
    expect(() => rank(['As', 'As'], ['Ks', 'Qs', 'Js', 'Ts', '2d'])).toThrow(
      /duplicate/i,
    );
    expect(() =>
      evaluateTexasHoldemHand(['As'] as unknown as HoleCards, [
        'Ks',
        'Qs',
        'Js',
        'Ts',
        '2d',
      ]),
    ).toThrow(/two/i);
  });

  it('rejects sparse and impossible public hand-rank vectors', () => {
    const sparse = Array<number>(1);
    const validStraightFlush = { category: 'straight-flush', tiebreak: [14] } as const;

    expect(() =>
      compareHandRanks(
        { category: 'straight-flush', tiebreak: sparse },
        { category: 'four-of-a-kind', tiebreak: [14, 13] },
      ),
    ).toThrow(/tiebreak/i);
    expect(() =>
      compareHandRanks(
        { category: 'straight-flush', tiebreak: sparse },
        validStraightFlush,
      ),
    ).toThrow(/tiebreak/i);
    expect(() =>
      compareHandRanks(
        { category: 'straight', tiebreak: [2] },
        { category: 'three-of-a-kind', tiebreak: [14, 13, 12] },
      ),
    ).toThrow(/tiebreak/i);
    expect(() =>
      compareHandRanks(
        { category: 'one-pair', tiebreak: [14, 14, 13, 12] },
        { category: 'one-pair', tiebreak: [13, 14, 12, 11] },
      ),
    ).toThrow(/tiebreak/i);
  });
});
