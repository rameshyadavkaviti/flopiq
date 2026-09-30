import type {
  BettingPlayerState,
  BettingRoundState,
  CreateBettingRoundStateInput,
} from '../src/state.js';
import { createBettingRoundState } from '../src/state.js';

type PlayerInput = Pick<BettingPlayerState, 'id' | 'seat'> & Partial<BettingPlayerState>;

export const player = (input: PlayerInput): BettingPlayerState => {
  const stack = input.stack ?? 100n;
  return {
    id: input.id,
    seat: input.seat,
    stack,
    streetCommitted: input.streetCommitted ?? 0n,
    handCommitted: input.handCommitted ?? input.streetCommitted ?? 0n,
    folded: input.folded ?? false,
    allIn: input.allIn ?? stack === 0n,
    actedSinceLastFullRaise: input.actedSinceLastFullRaise ?? false,
  };
};

interface StateInput extends Omit<Partial<CreateBettingRoundStateInput>, 'players'> {
  readonly players?: readonly BettingPlayerState[];
}

export const makeState = (input: StateInput = {}): BettingRoundState => {
  const players =
    input.players ??
    [
      player({ id: 'alice', seat: 0 }),
      player({ id: 'bob', seat: 1 }),
      player({ id: 'carol', seat: 2 }),
    ];

  const currentBet =
    input.currentBet ??
    players.reduce((maximum, current) =>
      current.streetCommitted > maximum ? current.streetCommitted : maximum,
    0n);

  const stateInput = {
    players,
    actingSeat: input.actingSeat === undefined ? players[0]?.seat ?? null : input.actingSeat,
    currentBet,
    minimumBet: input.minimumBet ?? 20n,
    minimumRaise: input.minimumRaise ?? 20n,
    lastFullRaise: input.lastFullRaise ?? input.minimumRaise ?? 20n,
  };

  return createBettingRoundState(
    input.actionSequence === undefined
      ? stateInput
      : { ...stateInput, actionSequence: input.actionSequence },
  );
};

export const findPlayer = (state: BettingRoundState, id: string): BettingPlayerState => {
  const found = state.players.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing test player ${id}`);
  return found;
};
