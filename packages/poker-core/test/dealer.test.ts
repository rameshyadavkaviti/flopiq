import { describe, expect, it } from 'vitest';

import { createStandardDeck, type Card } from '../src/cards.js';
import {
  createLocalDealer,
  revealFlop,
  revealRiver,
  revealTurn,
} from '../src/dealer.js';

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

describe('deterministic local dealer', () => {
  it('deals heads-up clockwise from the button with the big blind receiving first', () => {
    const state = createLocalDealer({
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    });

    expect(state.street).toBe('preflop');
    expect(state.nextCardIndex).toBe(4);
    expect(state.holeCards).toEqual([
      { playerId: 'alice', seat: 0, cards: ['Ks', 'Js'] },
      { playerId: 'bob', seat: 4, cards: ['As', 'Qs'] },
    ]);
    expect(state.board).toEqual([]);
    expect(state.burnedCards).toEqual([]);
  });

  it('deals sparse multi-player seats in clockwise order after the button', () => {
    const state = createLocalDealer({
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 1 },
        { id: 'bob', seat: 4 },
        { id: 'carol', seat: 8 },
      ],
      buttonSeat: 8,
    });

    expect(state.holeCards).toEqual([
      { playerId: 'alice', seat: 1, cards: ['As', 'Js'] },
      { playerId: 'bob', seat: 4, cards: ['Ks', 'Ts'] },
      { playerId: 'carol', seat: 8, cards: ['Qs', '9s'] },
    ]);
  });

  it('burns before the flop, turn, and river and preserves board order', () => {
    const preflop = createLocalDealer({
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    });

    const flop = revealFlop(preflop);
    const turn = revealTurn(flop);
    const river = revealRiver(turn);

    expect(flop.board).toEqual(['9s', '8s', '7s']);
    expect(flop.burnedCards).toEqual(['Ts']);
    expect(turn.board).toEqual(['9s', '8s', '7s', '5s']);
    expect(turn.burnedCards).toEqual(['Ts', '6s']);
    expect(river.board).toEqual(['9s', '8s', '7s', '5s', '3s']);
    expect(river.burnedCards).toEqual(['Ts', '6s', '4s']);
    expect(river.nextCardIndex).toBe(12);
  });

  it('does not mutate the supplied deck or earlier deal states', () => {
    const inputDeck = [...scriptedDeck];
    const preflop = createLocalDealer({
      deck: inputDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    });

    revealFlop(preflop);

    expect(inputDeck).toEqual(scriptedDeck);
    expect(preflop.board).toEqual([]);
    expect(preflop.burnedCards).toEqual([]);
    expect(preflop.nextCardIndex).toBe(4);
    expect(Object.isFrozen(preflop)).toBe(true);
    expect(Object.isFrozen(preflop.holeCards[0]?.cards)).toBe(true);
  });

  it('replays the same supplied deck to the same deal state', () => {
    const input = {
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    } as const;

    const first = revealRiver(revealTurn(revealFlop(createLocalDealer(input))));
    const second = revealRiver(revealTurn(revealFlop(createLocalDealer(input))));

    expect(first).toEqual(second);
  });

  it('rejects malformed participants and out-of-order reveals', () => {
    expect(() =>
      createLocalDealer({
        deck: scriptedDeck,
        players: [
          { id: 'alice', seat: 0 },
          { id: 'alice', seat: 4 },
        ],
        buttonSeat: 0,
      }),
    ).toThrow(/duplicate player/i);

    const preflop = createLocalDealer({
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    });

    expect(() => revealTurn(preflop)).toThrow(/flop/i);
    const river = revealRiver(revealTurn(revealFlop(preflop)));
    expect(() => revealRiver(river)).toThrow(/turn/i);
  });

  it('rejects reconstructed states with inconsistent cursor or board data', () => {
    const preflop = createLocalDealer({
      deck: scriptedDeck,
      players: [
        { id: 'alice', seat: 0 },
        { id: 'bob', seat: 4 },
      ],
      buttonSeat: 0,
    });

    expect(() => revealFlop({ ...preflop, nextCardIndex: 0 })).toThrow(/state/i);
    expect(() =>
      revealFlop({ ...preflop, board: ['2c', '3c', '4c', '5c', '6c'] }),
    ).toThrow(/state/i);
  });
});
