import { parseCard, type Card } from './cards.js';

export type HandCategory =
  | 'high-card'
  | 'one-pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

export interface HandRank {
  readonly category: HandCategory;
  readonly tiebreak: readonly number[];
}

const categoryStrength: Readonly<Record<HandCategory, number>> = Object.freeze({
  'high-card': 0,
  'one-pair': 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
});

const expectedTiebreakLength: Readonly<Record<HandCategory, number>> = Object.freeze({
  'high-card': 5,
  'one-pair': 4,
  'two-pair': 3,
  'three-of-a-kind': 3,
  straight: 1,
  flush: 5,
  'full-house': 2,
  'four-of-a-kind': 2,
  'straight-flush': 1,
});

const rankValue = (card: Card): number => {
  const rank = card[0];
  if (rank === undefined) throw new Error('Card rank disappeared');
  if (rank >= '2' && rank <= '9') return Number(rank);
  if (rank === 'T') return 10;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  if (rank === 'A') return 14;
  throw new Error('Card has an unknown rank');
};

const freezeRank = (category: HandCategory, tiebreak: readonly number[]): HandRank =>
  Object.freeze({ category, tiebreak: Object.freeze([...tiebreak]) });

const straightHighCard = (ranks: readonly number[]): number | null => {
  const unique = [...new Set(ranks)].sort((left, right) => right - left);
  if (unique.length !== 5) return null;
  const highest = unique[0];
  const lowest = unique[4];
  if (highest !== undefined && lowest !== undefined && highest - lowest === 4) return highest;
  if (unique.join(',') === '14,5,4,3,2') return 5;
  return null;
};

const evaluateFiveCards = (cards: readonly [Card, Card, Card, Card, Card]): HandRank => {
  const ranks = cards.map(rankValue).sort((left, right) => right - left);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    ([leftRank, leftCount], [rightRank, rightCount]) =>
      rightCount - leftCount || rightRank - leftRank,
  );

  const flush = cards.every((card) => card[1] === cards[0][1]);
  const straightHigh = straightHighCard(ranks);
  if (flush && straightHigh !== null) return freezeRank('straight-flush', [straightHigh]);

  const firstGroup = groups[0];
  const secondGroup = groups[1];
  if (firstGroup?.[1] === 4) {
    const kicker = groups.find(([, count]) => count === 1)?.[0];
    if (kicker === undefined) throw new Error('Four-of-a-kind kicker disappeared');
    return freezeRank('four-of-a-kind', [firstGroup[0], kicker]);
  }
  if (firstGroup?.[1] === 3 && secondGroup?.[1] === 2) {
    return freezeRank('full-house', [firstGroup[0], secondGroup[0]]);
  }
  if (flush) return freezeRank('flush', ranks);
  if (straightHigh !== null) return freezeRank('straight', [straightHigh]);
  if (firstGroup?.[1] === 3) {
    const kickers = groups
      .filter(([, count]) => count === 1)
      .map(([rank]) => rank)
      .sort((left, right) => right - left);
    return freezeRank('three-of-a-kind', [firstGroup[0], ...kickers]);
  }

  const pairs = groups
    .filter(([, count]) => count === 2)
    .map(([rank]) => rank)
    .sort((left, right) => right - left);
  if (pairs.length === 2) {
    const kicker = groups.find(([, count]) => count === 1)?.[0];
    if (pairs[0] === undefined || pairs[1] === undefined || kicker === undefined) {
      throw new Error('Two-pair ranks disappeared');
    }
    return freezeRank('two-pair', [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) {
    const pair = pairs[0];
    if (pair === undefined) throw new Error('Pair rank disappeared');
    const kickers = groups
      .filter(([, count]) => count === 1)
      .map(([rank]) => rank)
      .sort((left, right) => right - left);
    return freezeRank('one-pair', [pair, ...kickers]);
  }

  return freezeRank('high-card', ranks);
};

const assertHandRank = (rank: HandRank): void => {
  if (typeof rank !== 'object' || rank === null || !(rank.category in categoryStrength)) {
    throw new TypeError('Hand rank has an unknown category');
  }
  if (!Array.isArray(rank.tiebreak) || rank.tiebreak.length !== expectedTiebreakLength[rank.category]) {
    throw new Error('Hand rank has an invalid tiebreak vector');
  }
  if (!rank.tiebreak.every((value) => Number.isInteger(value) && value >= 2 && value <= 14)) {
    throw new Error('Hand rank tiebreak values must be card ranks');
  }
};

export const compareHandRanks = (left: HandRank, right: HandRank): -1 | 0 | 1 => {
  assertHandRank(left);
  assertHandRank(right);
  const categoryDifference = categoryStrength[left.category] - categoryStrength[right.category];
  if (categoryDifference !== 0) return categoryDifference > 0 ? 1 : -1;

  for (let index = 0; index < left.tiebreak.length; index += 1) {
    const leftValue = left.tiebreak[index];
    const rightValue = right.tiebreak[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error('Hand rank tiebreak value disappeared');
    }
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  return 0;
};

const validateCards = (
  holeCards: readonly Card[],
  board: readonly Card[],
): readonly Card[] => {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    throw new RangeError('Texas Hold’em requires exactly two private cards');
  }
  if (!Array.isArray(board) || board.length !== 5) {
    throw new RangeError('Texas Hold’em evaluation requires exactly five board cards');
  }

  const cards: Card[] = [];
  const seen = new Set<Card>();
  for (let index = 0; index < 7; index += 1) {
    const card = parseCard(index < 2 ? holeCards[index] : board[index - 2]);
    if (seen.has(card)) throw new Error(`Duplicate card in Hold’em hand: ${card}`);
    seen.add(card);
    cards.push(card);
  }
  return cards;
};

export const evaluateTexasHoldemHand = (
  holeCards: readonly [Card, Card],
  board: readonly [Card, Card, Card, Card, Card],
): HandRank => {
  const cards = validateCards(holeCards, board);
  let best: HandRank | null = null;

  for (let first = 0; first < 3; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      for (let third = second + 1; third < 5; third += 1) {
        for (let fourth = third + 1; fourth < 6; fourth += 1) {
          for (let fifth = fourth + 1; fifth < 7; fifth += 1) {
            const fiveCards = [
              cards[first],
              cards[second],
              cards[third],
              cards[fourth],
              cards[fifth],
            ];
            if (fiveCards.some((card) => card === undefined)) {
              throw new Error('Five-card combination referenced a missing card');
            }
            const candidate = evaluateFiveCards(
              fiveCards as [Card, Card, Card, Card, Card],
            );
            if (best === null || compareHandRanks(candidate, best) > 0) best = candidate;
          }
        }
      }
    }
  }

  if (best === null) throw new Error('No five-card combination could be evaluated');
  return best;
};
