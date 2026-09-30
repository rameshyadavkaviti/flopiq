import { describe, expect, it } from 'vitest';

import type { PokerAction } from '../src/actions.js';
import { reduceBettingAction } from '../src/betting.js';
import { assertBettingRoundInvariants } from '../src/invariants.js';
import type { BettingRoundState } from '../src/state.js';
import { makeState, player } from './helpers.js';

const generator = (seed: number): (() => number) => {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value;
  };
};

const actorFor = (state: BettingRoundState) => {
  const actor = state.players.find((candidate) => candidate.seat === state.actingSeat);
  if (actor === undefined) throw new Error('Generated active state has no actor');
  return actor;
};

const legalActions = (state: BettingRoundState): PokerAction[] => {
  const actor = actorFor(state);
  const actions: PokerAction[] = [{ type: 'fold', playerId: actor.id }];
  const totalAvailable = actor.streetCommitted + actor.stack;

  if (actor.streetCommitted === state.currentBet) {
    actions.push({ type: 'check', playerId: actor.id });
  } else {
    actions.push({ type: 'call', playerId: actor.id });
  }

  if (state.currentBet === 0n && actor.stack >= state.minimumBet) {
    actions.push({ type: 'bet', playerId: actor.id, amount: state.minimumBet });
  }

  if (
    state.currentBet > 0n &&
    !actor.actedSinceLastFullRaise &&
    totalAvailable >= state.currentBet + state.minimumRaise
  ) {
    actions.push({
      type: 'raise',
      playerId: actor.id,
      to: state.currentBet + state.minimumRaise,
    });
  }

  if (
    state.currentBet === 0n ||
    totalAvailable <= state.currentBet ||
    !actor.actedSinceLastFullRaise
  ) {
    actions.push({ type: 'all-in', playerId: actor.id });
  }

  return actions;
};

describe('generated betting sequences', () => {
  it('preserves invariants through deterministic generated valid actions', () => {
    const seenActions = new Set<PokerAction['type']>();
    let acceptedActions = 0;

    for (let seed = 1; seed <= 128; seed += 1) {
      const random = generator(seed);
      const playerCount = 2 + (random() % 8);
      const players = Array.from({ length: playerCount }, (_, seat) =>
        player({
          id: `seed-${seed}-player-${seat}`,
          seat,
          stack: BigInt(10 + (random() % 20) * 10),
        }),
      );
      let state = makeState({ players, minimumBet: 10n, minimumRaise: 10n });
      const initialTotal = state.totalChips;
      let steps = 0;

      while (state.status === 'active') {
        steps += 1;
        expect(steps).toBeLessThan(1_000);

        const candidates = legalActions(state);
        const action = candidates[(random() >>> 16) % candidates.length];
        if (action === undefined) throw new Error('Generator produced no action');
        const inputSnapshot = {
          ...state,
          players: state.players.map((current) => ({ ...current })),
        };

        const result = reduceBettingAction(state, action);
        assertBettingRoundInvariants(result.state);
        expect(result.state.totalChips).toBe(initialTotal);
        expect(result.state.actionSequence).toBe(state.actionSequence + 1);
        expect(result.state.players.every((current) => current.stack >= 0n)).toBe(true);
        expect(state).toEqual(inputSnapshot);

        seenActions.add(action.type);
        acceptedActions += 1;
        state = result.state;
      }
    }

    expect(acceptedActions).toBeGreaterThan(128);
    expect(seenActions).toEqual(new Set(['fold', 'check', 'call', 'bet', 'raise', 'all-in']));
  });
});
