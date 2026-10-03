import {
  advanceHandAfterDeal,
  assertHandStateInvariants,
  assertLocalDealerInvariants,
  createHand,
  createLocalDealer,
  createNextHand,
  evaluateTexasHoldemHand,
  reduceHandAction,
  resolveHandShowdown,
  revealFlop,
  revealRiver,
  revealTurn,
  type Card,
  type ChipAmount,
  type HandStartPlayer,
  type HandState,
  type LocalDealerState,
  type PokerAction,
  type PokerEvent,
} from '@flopiq/poker-core';

export interface LocalTableConfig {
  readonly players: readonly HandStartPlayer[];
  readonly buttonSeat: number;
  readonly smallBlind: ChipAmount;
  readonly bigBlind: ChipAmount;
  readonly decks: readonly (readonly Card[])[];
}

export interface LocalTableSession {
  readonly hand: HandState;
  readonly dealer: LocalDealerState;
  readonly decks: readonly (readonly Card[])[];
  readonly nextDeckIndex: number;
}

export interface LocalCommandResult {
  readonly session: LocalTableSession;
  readonly events: readonly PokerEvent[];
  readonly output: string;
}

export interface LocalScriptResult {
  readonly session: LocalTableSession;
  readonly transcript: readonly string[];
}

const freezeDecks = (
  decks: readonly (readonly Card[])[],
): readonly (readonly Card[])[] =>
  Object.freeze(decks.map((deck) => Object.freeze([...deck])));

const freezeSession = (session: LocalTableSession): LocalTableSession =>
  Object.freeze({ ...session });

const dealerPlayersForHand = (hand: HandState) =>
  hand.betting.players.map((player) => ({ id: player.id, seat: player.seat }));

export const assertLocalTableSession = (session: LocalTableSession): void => {
  if (typeof session !== 'object' || session === null) {
    throw new TypeError('Local table session must be an object');
  }

  assertHandStateInvariants(session.hand);
  assertLocalDealerInvariants(session.dealer);

  if (!Array.isArray(session.decks) || session.decks.length === 0) {
    throw new Error('Local table requires at least one explicit deck');
  }
  if (
    !Number.isSafeInteger(session.nextDeckIndex) ||
    session.nextDeckIndex < 1 ||
    session.nextDeckIndex > session.decks.length
  ) {
    throw new Error('Local table has an invalid deck cursor');
  }
  if (session.hand.buttonSeat !== session.dealer.buttonSeat) {
    throw new Error('Hand and dealer button seats do not match');
  }
  if (session.hand.street !== session.dealer.street) {
    throw new Error('Hand and dealer streets do not match');
  }

  const handPlayers = session.hand.betting.players
    .map((player) => ({ id: player.id, seat: player.seat }))
    .sort((left, right) => left.seat - right.seat);
  const dealerPlayers = session.dealer.holeCards
    .map((entry) => ({ id: entry.playerId, seat: entry.seat }))
    .sort((left, right) => left.seat - right.seat);

  if (
    handPlayers.length !== dealerPlayers.length ||
    handPlayers.some(
      (player, index) =>
        player.id !== dealerPlayers[index]?.id || player.seat !== dealerPlayers[index]?.seat,
    )
  ) {
    throw new Error('Hand and dealer participants do not match');
  }
};

const resolveLocalShowdown = (
  hand: HandState,
  dealer: LocalDealerState,
): HandState => {
  if (dealer.street !== 'river' || dealer.board.length !== 5) {
    throw new Error('Local dealer must reach a complete river before showdown');
  }
  const board = dealer.board as readonly [Card, Card, Card, Card, Card];
  const rankedPlayers = hand.betting.players
    .filter((player) => !player.folded)
    .map((player) => {
      const dealt = dealer.holeCards.find((entry) => entry.playerId === player.id);
      if (dealt === undefined || dealt.seat !== player.seat) {
        throw new Error(`Missing local hole cards for player: ${player.id}`);
      }
      return {
        playerId: player.id,
        rank: evaluateTexasHoldemHand(dealt.cards, board),
      };
    });

  return resolveHandShowdown(hand, rankedPlayers);
};

const stabilize = (
  handInput: HandState,
  dealerInput: LocalDealerState,
): readonly [HandState, LocalDealerState] => {
  let hand = handInput;
  let dealer = dealerInput;

  while (hand.phase === 'awaiting-next-street') {
    if (hand.street !== dealer.street) {
      throw new Error('Hand and dealer streets diverged before a reveal');
    }

    switch (dealer.street) {
      case 'preflop':
        dealer = revealFlop(dealer);
        hand = advanceHandAfterDeal(hand, 'flop');
        break;
      case 'flop':
        dealer = revealTurn(dealer);
        hand = advanceHandAfterDeal(hand, 'turn');
        break;
      case 'turn':
        dealer = revealRiver(dealer);
        hand = advanceHandAfterDeal(hand, 'river');
        break;
      case 'river':
        throw new Error('River cannot advance to another betting street');
    }
  }

  if (hand.phase === 'awaiting-showdown') {
    hand = resolveLocalShowdown(hand, dealer);
  }

  return Object.freeze([hand, dealer]);
};

export const createLocalTable = (config: LocalTableConfig): LocalTableSession => {
  if (!Array.isArray(config.players) || config.players.length !== 2) {
    throw new RangeError('Local playable adapter requires exactly two players');
  }
  if (!Array.isArray(config.decks) || config.decks.length === 0) {
    throw new RangeError('Local playable adapter requires at least one explicit deck');
  }

  const decks = freezeDecks(config.decks);
  const hand = createHand({
    players: config.players,
    buttonSeat: config.buttonSeat,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
  });
  const dealer = createLocalDealer({
    deck: decks[0] ?? [],
    players: dealerPlayersForHand(hand),
    buttonSeat: hand.buttonSeat,
  });
  const [stableHand, stableDealer] = stabilize(hand, dealer);
  const session = freezeSession({
    hand: stableHand,
    dealer: stableDealer,
    decks,
    nextDeckIndex: 1,
  });
  assertLocalTableSession(session);
  return session;
};

const actorForHand = (hand: HandState): string => {
  const seat = hand.betting.actingSeat;
  if (seat === null) throw new Error('Local table has no current actor');
  const player = hand.betting.players.find((candidate) => candidate.seat === seat);
  if (player === undefined) throw new Error('Local table actor disappeared');
  return player.id;
};

const parseChip = (raw: string | undefined): bigint => {
  if (raw === undefined || !/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error('CHIP amount must be a canonical nonnegative integer');
  }
  return BigInt(raw);
};

const parsePlayerAction = (hand: HandState, command: string): PokerAction => {
  if (hand.phase !== 'betting') throw new Error('Current hand is not accepting player actions');
  const playerId = actorForHand(hand);
  const parts = command.trim().toLowerCase().split(/\s+/);
  const verb = parts[0];

  if (parts.length === 1) {
    if (verb === 'fold') return { type: 'fold', playerId };
    if (verb === 'check') return { type: 'check', playerId };
    if (verb === 'call') return { type: 'call', playerId };
    if (verb === 'all-in' || verb === 'allin') return { type: 'all-in', playerId };
  }

  if (parts.length === 2 && verb === 'bet') {
    return { type: 'bet', playerId, amount: parseChip(parts[1]) };
  }
  if (parts.length === 2 && verb === 'raise') {
    return { type: 'raise', playerId, to: parseChip(parts[1]) };
  }

  throw new Error('Unknown command. Use fold, check, call, bet N, raise N, all-in, or next');
};

const startNextLocalHand = (session: LocalTableSession): LocalTableSession => {
  const hand = createNextHand(session.hand);
  const deck = session.decks[session.nextDeckIndex];
  if (deck === undefined) {
    throw new Error('No explicit deck is available for the next hand');
  }

  const dealer = createLocalDealer({
    deck,
    players: dealerPlayersForHand(hand),
    buttonSeat: hand.buttonSeat,
  });
  const [stableHand, stableDealer] = stabilize(hand, dealer);
  const next = freezeSession({
    hand: stableHand,
    dealer: stableDealer,
    decks: session.decks,
    nextDeckIndex: session.nextDeckIndex + 1,
  });
  assertLocalTableSession(next);
  return next;
};

export const renderLocalTable = (session: LocalTableSession): string => {
  assertLocalTableSession(session);
  const handNumber = session.nextDeckIndex;
  const actor =
    session.hand.betting.actingSeat === null
      ? '-'
      : session.hand.betting.players.find(
          (player) => player.seat === session.hand.betting.actingSeat,
        )?.id ?? '-';
  const button =
    session.hand.betting.players.find((player) => player.seat === session.hand.buttonSeat)?.id ??
    String(session.hand.buttonSeat);
  const board = session.dealer.board.length === 0 ? '-' : session.dealer.board.join(' ');
  const players = session.hand.betting.players
    .map((player) => {
      const flags = [player.folded ? 'folded' : '', player.allIn ? 'all-in' : '']
        .filter((flag) => flag.length > 0)
        .join(',');
      return `${player.id}@${player.seat}:stack=${player.stack}:committed=${player.handCommitted}${flags.length > 0 ? `:${flags}` : ''}`;
    })
    .join(' ');

  let result = '';
  if (session.hand.completion?.type === 'fold') {
    result = ` result=fold:${session.hand.completion.settlement.winnerId}`;
  } else if (session.hand.completion?.type === 'showdown') {
    result = ` result=${session.hand.completion.settlement.players
      .map((player) => `${player.playerId}=${player.endingStack}`)
      .join(',')}`;
  }

  return `hand=${handNumber} street=${session.hand.street} phase=${session.hand.phase} button=${button} actor=${actor} board=${board} players=[${players}]${result}`;
};

export const holeCardsForPlayer = (
  session: LocalTableSession,
  playerId: string,
): readonly [Card, Card] => {
  assertLocalTableSession(session);
  const dealt = session.dealer.holeCards.find((entry) => entry.playerId === playerId);
  if (dealt === undefined) throw new Error(`Unknown local player: ${playerId}`);
  return dealt.cards;
};

export const applyLocalCommand = (
  session: LocalTableSession,
  command: string,
): LocalCommandResult => {
  assertLocalTableSession(session);
  const normalized = command.trim().toLowerCase();

  if (normalized === 'next') {
    if (session.hand.phase !== 'complete') {
      throw new Error('Next hand cannot start before the current hand is complete');
    }
    const nextSession = startNextLocalHand(session);
    return Object.freeze({
      session: nextSession,
      events: Object.freeze([]),
      output: renderLocalTable(nextSession),
    });
  }

  const action = parsePlayerAction(session.hand, command);
  const actionResult = reduceHandAction(session.hand, action);
  const [hand, dealer] = stabilize(actionResult.state, session.dealer);
  const nextSession = freezeSession({
    ...session,
    hand,
    dealer,
  });
  assertLocalTableSession(nextSession);

  return Object.freeze({
    session: nextSession,
    events: actionResult.events,
    output: renderLocalTable(nextSession),
  });
};

export const runLocalTableScript = (
  config: LocalTableConfig,
  commands: readonly string[],
): LocalScriptResult => {
  if (!Array.isArray(commands)) throw new TypeError('Local table commands must be an array');

  let session = createLocalTable(config);
  const transcript: string[] = [renderLocalTable(session)];
  for (const command of commands) {
    const result = applyLocalCommand(session, command);
    session = result.session;
    transcript.push(result.output);
  }

  return Object.freeze({
    session,
    transcript: Object.freeze(transcript),
  });
};
