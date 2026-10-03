import { type Card, validateDeck } from './cards.js';
import { nextOccupiedSeat } from './positions.js';

export interface DealPlayer {
  readonly id: string;
  readonly seat: number;
}

export interface PlayerHoleCards {
  readonly playerId: string;
  readonly seat: number;
  readonly cards: readonly [Card, Card];
}

export interface CreateLocalDealerInput {
  readonly deck: readonly Card[];
  readonly players: readonly DealPlayer[];
  readonly buttonSeat: number;
}

export interface LocalDealerState {
  readonly deck: readonly Card[];
  readonly buttonSeat: number;
  readonly holeCards: readonly PlayerHoleCards[];
  readonly board: readonly Card[];
  readonly burnedCards: readonly Card[];
  readonly nextCardIndex: number;
  readonly street: 'preflop' | 'flop' | 'turn' | 'river';
}

const assertSeat = (seat: number): void => {
  if (!Number.isSafeInteger(seat) || seat < 0 || seat > 8) {
    throw new RangeError('Seat must be an integer from 0 through 8');
  }
};

const validatePlayers = (players: readonly DealPlayer[]): readonly DealPlayer[] => {
  if (!Array.isArray(players)) throw new TypeError('Deal players must be an array');
  if (players.length < 2 || players.length > 9) {
    throw new RangeError('A deal requires 2 through 9 players');
  }

  const ids = new Set<string>();
  const seats = new Set<number>();
  const validated = players.map((player) => {
    if (typeof player !== 'object' || player === null) {
      throw new TypeError('Deal player must be an object');
    }
    if (typeof player.id !== 'string' || player.id.length === 0) {
      throw new TypeError('Player identity must be a nonempty string');
    }
    assertSeat(player.seat);
    if (ids.has(player.id)) throw new Error(`Duplicate player identity: ${player.id}`);
    if (seats.has(player.seat)) throw new Error(`Duplicate seat: ${player.seat}`);
    ids.add(player.id);
    seats.add(player.seat);
    return Object.freeze({ ...player });
  });

  return Object.freeze(validated.sort((left, right) => left.seat - right.seat));
};

const cardAt = (deck: readonly Card[], index: number): Card => {
  const card = deck[index];
  if (card === undefined) throw new Error('Dealer attempted to read beyond the supplied deck');
  return card;
};

const freezeState = (state: LocalDealerState): LocalDealerState =>
  Object.freeze({
    ...state,
    deck: Object.freeze([...state.deck]),
    holeCards: Object.freeze(
      state.holeCards.map((player) =>
        Object.freeze({ ...player, cards: Object.freeze([...player.cards]) as readonly [Card, Card] }),
      ),
    ),
    board: Object.freeze([...state.board]),
    burnedCards: Object.freeze([...state.burnedCards]),
  });

const clockwiseDealOrder = (
  players: readonly DealPlayer[],
  buttonSeat: number,
): readonly DealPlayer[] => {
  const seats = players.map((player) => player.seat);
  let seat = nextOccupiedSeat(seats, buttonSeat);
  const ordered: DealPlayer[] = [];

  for (let index = 0; index < players.length; index += 1) {
    const player = players.find((candidate) => candidate.seat === seat);
    if (player === undefined) throw new Error('Deal order referenced an empty seat');
    ordered.push(player);
    seat = nextOccupiedSeat(seats, seat);
  }

  return ordered;
};

export const createLocalDealer = (input: CreateLocalDealerInput): LocalDealerState => {
  const deck = validateDeck(input.deck);
  const players = validatePlayers(input.players);
  assertSeat(input.buttonSeat);
  if (!players.some((player) => player.seat === input.buttonSeat)) {
    throw new Error('Button seat must identify a deal participant');
  }

  const cardsBySeat = new Map<number, Card[]>();
  for (const player of players) cardsBySeat.set(player.seat, []);

  const order = clockwiseDealOrder(players, input.buttonSeat);
  let nextCardIndex = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const player of order) {
      cardsBySeat.get(player.seat)?.push(cardAt(deck, nextCardIndex));
      nextCardIndex += 1;
    }
  }

  const holeCards = players.map((player): PlayerHoleCards => {
    const cards = cardsBySeat.get(player.seat);
    if (cards?.[0] === undefined || cards[1] === undefined) {
      throw new Error('Player did not receive exactly two hole cards');
    }
    return { playerId: player.id, seat: player.seat, cards: [cards[0], cards[1]] };
  });

  return freezeState({
    deck,
    buttonSeat: input.buttonSeat,
    holeCards,
    board: [],
    burnedCards: [],
    nextCardIndex,
    street: 'preflop',
  });
};

const reveal = (
  state: LocalDealerState,
  requiredStreet: LocalDealerState['street'],
  nextStreet: LocalDealerState['street'],
  boardCardCount: number,
): LocalDealerState => {
  if (state.street !== requiredStreet) {
    throw new Error(`${nextStreet[0]?.toUpperCase() ?? ''}${nextStreet.slice(1)} may only be revealed after ${requiredStreet}`);
  }

  const burnedCard = cardAt(state.deck, state.nextCardIndex);
  const revealed: Card[] = [];
  for (let offset = 1; offset <= boardCardCount; offset += 1) {
    revealed.push(cardAt(state.deck, state.nextCardIndex + offset));
  }

  return freezeState({
    ...state,
    board: [...state.board, ...revealed],
    burnedCards: [...state.burnedCards, burnedCard],
    nextCardIndex: state.nextCardIndex + boardCardCount + 1,
    street: nextStreet,
  });
};

export const revealFlop = (state: LocalDealerState): LocalDealerState =>
  reveal(state, 'preflop', 'flop', 3);

export const revealTurn = (state: LocalDealerState): LocalDealerState =>
  reveal(state, 'flop', 'turn', 1);

export const revealRiver = (state: LocalDealerState): LocalDealerState =>
  reveal(state, 'turn', 'river', 1);
