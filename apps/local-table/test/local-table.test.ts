import { describe, expect, it } from 'vitest';

import { createStandardDeck, type Card } from '@flopiq/poker-core';

import {
  applyLocalCommand,
  createLocalTable,
  holeCardsForPlayer,
  runLocalTableScript,
} from '../src/index.js';

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

const config = (decks: readonly (readonly Card[])[]) => ({
  players: [
    { id: 'alice', seat: 0, stack: 100n },
    { id: 'bob', seat: 4, stack: 100n },
  ],
  buttonSeat: 0,
  smallBlind: 5n,
  bigBlind: 10n,
  decks,
});

describe('thin local playable adapter', () => {
  it('plays a complete deterministic heads-up hand and starts the next hand', () => {
    const result = runLocalTableScript(config([scriptedDeck, scriptedDeck]), [
      'call',
      'check',
      'check',
      'check',
      'check',
      'check',
      'check',
      'check',
      'next',
    ]);

    expect(result.transcript).toHaveLength(10);
    expect(result.transcript.some((line) => line.includes('street=flop phase=betting'))).toBe(true);
    expect(result.transcript.some((line) => line.includes('street=turn phase=betting'))).toBe(true);
    expect(result.transcript.some((line) => line.includes('street=river phase=betting'))).toBe(true);
    expect(result.transcript.at(-2)).toContain('phase=complete');
    expect(result.transcript.at(-2)).toContain('alice=90,bob=110');

    expect(result.session.nextDeckIndex).toBe(2);
    expect(result.session.hand.phase).toBe('betting');
    expect(result.session.hand.street).toBe('preflop');
    expect(result.session.hand.buttonSeat).toBe(4);
    expect(result.session.hand.betting.actingSeat).toBe(4);
    expect(result.session.hand.betting.players.map((player) => player.stack)).toEqual([
      80n,
      105n,
    ]);
    expect(result.session.hand.betting.totalChips).toBe(200n);
    expect(result.session.dealer.buttonSeat).toBe(4);
    expect(holeCardsForPlayer(result.session, 'alice')).toEqual(['As', 'Qs']);
    expect(holeCardsForPlayer(result.session, 'bob')).toEqual(['Ks', 'Js']);
  });

  it('automatically runs the board and settles when both players are all-in', () => {
    let session = createLocalTable(config([scriptedDeck]));

    session = applyLocalCommand(session, 'all-in').session;
    expect(session.hand.phase).toBe('betting');
    expect(session.hand.betting.actingSeat).toBe(4);

    session = applyLocalCommand(session, 'call').session;

    expect(session.hand.phase).toBe('complete');
    expect(session.hand.street).toBe('river');
    expect(session.dealer.street).toBe('river');
    expect(session.dealer.board).toHaveLength(5);
    expect(session.hand.completion?.type).toBe('showdown');
    if (session.hand.completion?.type !== 'showdown') throw new Error('Expected showdown');

    expect(session.hand.completion.winners).toEqual([{ potIndex: 0, winnerIds: ['bob'] }]);
    expect(session.hand.completion.settlement.players.map((player) => player.endingStack)).toEqual([
      0n,
      200n,
    ]);
  });

  it('parses bet/call commands but leaves their legality to Poker Core', () => {
    let session = createLocalTable(config([scriptedDeck]));

    expect(() => applyLocalCommand(session, 'check')).toThrow(/cannot check/i);

    session = applyLocalCommand(session, 'call').session;
    session = applyLocalCommand(session, 'check').session;
    expect(session.hand.street).toBe('flop');
    expect(session.hand.betting.actingSeat).toBe(4);

    session = applyLocalCommand(session, 'bet 10').session;
    expect(session.hand.betting.currentBet).toBe(10n);
    expect(session.hand.betting.actingSeat).toBe(0);

    session = applyLocalCommand(session, 'call').session;
    expect(session.hand.street).toBe('turn');
    expect(session.hand.betting.players.map((player) => player.handCommitted)).toEqual([
      20n,
      20n,
    ]);
  });

  it('rejects malformed commands without mutating accepted state', () => {
    const session = createLocalTable(config([scriptedDeck]));
    const before = session;

    expect(() => applyLocalCommand(session, 'bet 01')).toThrow(/canonical/i);
    expect(() => applyLocalCommand(session, 'raise nope')).toThrow(/canonical/i);
    expect(() => applyLocalCommand(session, 'dance')).toThrow(/unknown command/i);

    expect(session).toBe(before);
    expect(session.hand.betting.totalChips).toBe(200n);
  });

  it('requires an explicit deck for every requested next hand', () => {
    const completed = runLocalTableScript(config([scriptedDeck]), [
      'call',
      'check',
      'check',
      'check',
      'check',
      'check',
      'check',
      'check',
    ]).session;

    expect(completed.hand.phase).toBe('complete');
    expect(() => applyLocalCommand(completed, 'next')).toThrow(/explicit deck/i);
  });

  it('exposes only the requested player hole cards through the view helper', () => {
    const session = createLocalTable(config([scriptedDeck]));

    expect(holeCardsForPlayer(session, 'alice')).toEqual(['Ks', 'Js']);
    expect(holeCardsForPlayer(session, 'bob')).toEqual(['As', 'Qs']);
    expect(() => holeCardsForPlayer(session, 'mallory')).toThrow(/unknown local player/i);
  });
});
