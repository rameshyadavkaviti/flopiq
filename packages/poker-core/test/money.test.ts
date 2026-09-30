import { describe, expect, it } from 'vitest';

import {
  addChips,
  chips,
  parseChips,
  serializeChips,
  subtractChips,
} from '../src/money.js';

describe('CHIP amounts', () => {
  it('accepts nonnegative bigint values', () => {
    expect(chips(0n)).toBe(0n);
    expect(chips(42n)).toBe(42n);
  });

  it.each(['', ' 1', '1 ', '+1', '-1', '01', '1.0', '1e3', '0x10']) (
    'rejects malformed or noncanonical input %j',
    (value) => {
      expect(() => parseChips(value)).toThrow(/canonical/i);
    },
  );

  it('rejects negative CHIP and JavaScript number input', () => {
    expect(() => chips(-1n)).toThrow(/nonnegative/i);
    expect(() => (chips as (value: unknown) => bigint)(1)).toThrow(/bigint or canonical/i);
  });

  it.each([Number.MAX_SAFE_INTEGER + 2, 1n, { toString: () => '1' }])(
    'rejects non-string values passed directly to the parser',
    (value) => {
      expect(() => (parseChips as (input: unknown) => bigint)(value)).toThrow(/string/i);
    },
  );

  it('serializes without a floating-point conversion', () => {
    const value = parseChips('9007199254740993123456789');

    expect(serializeChips(value)).toBe('9007199254740993123456789');
  });

  it('adds and subtracts CHIP using bigint arithmetic', () => {
    expect(addChips(chips(7n), chips(5n))).toBe(12n);
    expect(subtractChips(chips(7n), chips(5n))).toBe(2n);
  });

  it('rejects subtraction underflow', () => {
    expect(() => subtractChips(chips(4n), chips(5n))).toThrow(/underflow/i);
  });
});
