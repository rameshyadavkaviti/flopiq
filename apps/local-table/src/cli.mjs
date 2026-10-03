import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createStandardDeck } from '@flopiq/poker-core';

import {
  applyLocalCommand,
  createLocalTable,
  holeCardsForPlayer,
  renderLocalTable,
} from './index.ts';

const write = (message) => {
  output.write(`${message}\n`);
};

let session = createLocalTable({
  players: [
    { id: 'alice', seat: 0, stack: 100n },
    { id: 'bob', seat: 4, stack: 100n },
  ],
  buttonSeat: 0,
  smallBlind: 5n,
  bigBlind: 10n,
  decks: Array.from({ length: 100 }, () => createStandardDeck()),
});

const readline = createInterface({ input, output });

write('Flopiq local table');
write('Commands: fold, check, call, bet N, raise N, all-in, cards, next, quit');
write(renderLocalTable(session));

try {
  while (true) {
    const actorSeat = session.hand.betting.actingSeat;
    const actor =
      actorSeat === null
        ? 'table'
        : session.hand.betting.players.find((player) => player.seat === actorSeat)?.id ?? 'table';
    const command = (await readline.question(`${actor}> `)).trim();

    if (command === 'quit' || command === 'exit') break;
    if (command === 'cards') {
      if (actorSeat === null) {
        write('No player is currently acting.');
        continue;
      }
      const player = session.hand.betting.players.find((candidate) => candidate.seat === actorSeat);
      if (player === undefined) {
        write('Current actor is unavailable.');
        continue;
      }
      write(`${player.id}: ${holeCardsForPlayer(session, player.id).join(' ')}`);
      continue;
    }

    try {
      const result = applyLocalCommand(session, command);
      session = result.session;
      write(result.output);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
    }
  }
} finally {
  readline.close();
}
