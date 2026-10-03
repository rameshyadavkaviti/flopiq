export const CARD_RANKS = Object.freeze([
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
] as const);

export const CARD_SUITS = Object.freeze(['c', 'd', 'h', 's'] as const);

export type CardRank = (typeof CARD_RANKS)[number];
export type CardSuit = (typeof CARD_SUITS)[number];
export type Card = `${CardRank}${CardSuit}`;

const rankSet = new Set<string>(CARD_RANKS);
const suitSet = new Set<string>(CARD_SUITS);

export const parseCard = (input: unknown): Card => {
  if (typeof input !== 'string' || input.length !== 2) {
    throw new TypeError('Card must use canonical rank-suit notation');
  }

  const rank = input[0];
  const suit = input[1];
  if (rank === undefined || suit === undefined || !rankSet.has(rank) || !suitSet.has(suit)) {
    throw new TypeError('Card must use canonical rank-suit notation');
  }

  return input as Card;
};

export const createStandardDeck = (): readonly Card[] => {
  const cards: Card[] = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) cards.push(`${rank}${suit}`);
  }
  return Object.freeze(cards);
};

export const validateDeck = (input: readonly unknown[]): readonly Card[] => {
  if (!Array.isArray(input)) throw new TypeError('Deck must be an array');
  if (input.length !== 52) throw new RangeError('Deck must contain exactly 52 cards');

  const seen = new Set<Card>();
  const cards: Card[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const card = parseCard(input[index]);
    if (seen.has(card)) throw new Error(`Deck contains duplicate card: ${card}`);
    seen.add(card);
    cards.push(card);
  }

  return Object.freeze(cards);
};
