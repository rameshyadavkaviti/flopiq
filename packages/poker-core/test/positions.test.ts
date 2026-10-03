import { describe, expect, it } from 'vitest';

import {
  assignHandPositions,
  nextButtonSeat,
  nextOccupiedSeat,
} from '../src/positions.js';

describe('table positions and action order', () => {
  it('uses heads-up button/blind/action-order rules', () => {
    expect(assignHandPositions([0, 1], 0)).toEqual({
      buttonSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      preflopFirstSeat: 0,
      postflopFirstSeat: 1,
    });

    expect(assignHandPositions([0, 1], 1)).toEqual({
      buttonSeat: 1,
      smallBlindSeat: 1,
      bigBlindSeat: 0,
      preflopFirstSeat: 1,
      postflopFirstSeat: 0,
    });
  });

  it('assigns blinds and first actors clockwise for three or more players', () => {
    expect(assignHandPositions([0, 1, 2, 3], 0)).toEqual({
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      preflopFirstSeat: 3,
      postflopFirstSeat: 1,
    });
  });

  it('supports sparse seats and wraps around seat eight', () => {
    expect(assignHandPositions([1, 4, 8], 8)).toEqual({
      buttonSeat: 8,
      smallBlindSeat: 1,
      bigBlindSeat: 4,
      preflopFirstSeat: 8,
      postflopFirstSeat: 1,
    });

    expect(nextOccupiedSeat([1, 4, 8], 4)).toBe(8);
    expect(nextOccupiedSeat([1, 4, 8], 8)).toBe(1);
  });

  it('rotates the button only across occupied seats', () => {
    expect(nextButtonSeat([1, 4, 8], 1)).toBe(4);
    expect(nextButtonSeat([1, 4, 8], 4)).toBe(8);
    expect(nextButtonSeat([1, 4, 8], 8)).toBe(1);
  });

  it('does not mutate caller-owned seat arrays', () => {
    const seats = [8, 1, 4];
    const positions = assignHandPositions(seats, 8);

    expect(seats).toEqual([8, 1, 4]);
    expect(Object.isFrozen(positions)).toBe(true);
  });

  it('rejects invalid table position inputs', () => {
    expect(() => assignHandPositions([0], 0)).toThrow(/between 2 and 9/i);
    expect(() => assignHandPositions([0, 0], 0)).toThrow(/unique/i);
    expect(() => assignHandPositions([0, 9], 0)).toThrow(/between 0 and 8/i);
    expect(() => assignHandPositions([0, 1], 2)).toThrow(/button seat/i);
    expect(() => nextButtonSeat([0, 1], 2)).toThrow(/button seat/i);
    expect(() => nextOccupiedSeat([0, 1], -1)).toThrow(/reference seat/i);
  });
});
