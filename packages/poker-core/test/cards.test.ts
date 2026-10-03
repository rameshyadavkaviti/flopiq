import { describe, expect, it } from 'vitest';

import { createStandardDeck, parseCard, validateDeck } from '../src/cards.js';

describe('cards', () => {
  it('accepts only canonical two-character cards', () => {
    expect(parseCard('As')).toBe('As');
    expect(parseCard('Tc')).toBe('Tc');

    for (const malformed of ['10s', 'as', 'AX', '', 10, null]) {
      expect(() => parseCard(malformed)).toThrow(/card/i);
    }
  });

  it('creates one deterministic canonical copy of every card', () => {
    const deck = createStandardDeck();

    expect(deck).toHaveLength(52);
    expect(new Set(deck)).toHaveLength(52);
    expect(deck.slice(0, 4)).toEqual(['2c', '3c', '4c', '5c']);
    expect(deck.at(-1)).toBe('As');
    expect(Object.isFrozen(deck)).toBe(true);
  });

  it('validates a complete unique deck without mutating caller order', () => {
    const input = [...createStandardDeck()].reverse();
    const snapshot = [...input];

    const deck = validateDeck(input);

    expect(deck).toEqual(snapshot);
    expect(input).toEqual(snapshot);
    expect(deck).not.toBe(input);
    expect(Object.isFrozen(deck)).toBe(true);
  });

  it('rejects incomplete, duplicate, and malformed decks', () => {
    const complete = [...createStandardDeck()];

    expect(() => validateDeck(complete.slice(0, 51))).toThrow(/52/i);
    expect(() => validateDeck([...complete.slice(0, 51), complete[0]])).toThrow(/duplicate/i);
    expect(() => validateDeck([...complete.slice(0, 51), '10s'])).toThrow(/card/i);
  });
});
