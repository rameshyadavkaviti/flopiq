import { describe, expect, it } from 'vitest';

import { assertBettingRoundInvariants, representedChips } from '../src/invariants.js';
import type { BettingRoundState } from '../src/state.js';
import { makeState } from './helpers.js';

describe('betting state invariants', () => {
  it('accepts a valid state and totals represented CHIP', () => {
    const state = makeState();
    expect(() => assertBettingRoundInvariants(state)).not.toThrow();
    expect(representedChips(state)).toBe(300n);
  });

  it('detects CHIP creation or destruction', () => {
    const state = makeState();
    const corrupted = { ...state, totalChips: 301n } as BettingRoundState;

    expect(() => assertBettingRoundInvariants(corrupted)).toThrow(/conservation/i);
  });

  it('detects negative values, duplicate identities, and duplicate seats', () => {
    const state = makeState();
    const negative = {
      ...state,
      players: [{ ...state.players[0], stack: -1n }, ...state.players.slice(1)],
    } as BettingRoundState;
    expect(() => assertBettingRoundInvariants(negative)).toThrow(/nonnegative/i);

    const duplicatePlayer = {
      ...state,
      players: [state.players[0], { ...state.players[1], id: state.players[0]?.id }],
    } as BettingRoundState;
    expect(() => assertBettingRoundInvariants(duplicatePlayer)).toThrow(/duplicate player/i);

    const duplicateSeat = {
      ...state,
      players: [state.players[0], { ...state.players[1], seat: state.players[0]?.seat }],
    } as BettingRoundState;
    expect(() => assertBettingRoundInvariants(duplicateSeat)).toThrow(/duplicate seat/i);
  });

  it('detects an invalid actor and status mismatch', () => {
    const state = makeState();
    const absentActor = { ...state, actingSeat: 8 } as BettingRoundState;
    expect(() => assertBettingRoundInvariants(absentActor)).toThrow(/acting seat/i);

    const completeWithActor = { ...state, status: 'complete' } as BettingRoundState;
    expect(() => assertBettingRoundInvariants(completeWithActor)).toThrow(/complete round/i);
  });
});
