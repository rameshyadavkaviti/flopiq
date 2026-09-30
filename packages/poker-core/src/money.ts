export type ChipAmount = bigint;

const CANONICAL_CHIP_PATTERN = /^(?:0|[1-9]\d*)$/;

export function assertChipAmount(value: unknown): asserts value is ChipAmount {
  if (typeof value !== 'bigint') {
    throw new TypeError('CHIP must be a bigint or canonical decimal string');
  }
  if (value < 0n) {
    throw new RangeError('CHIP must be nonnegative');
  }
}

export const parseChips = (value: string): ChipAmount => {
  if (!CANONICAL_CHIP_PATTERN.test(value)) {
    throw new TypeError('CHIP string must use canonical nonnegative decimal form');
  }

  return BigInt(value);
};

export const chips = (value: bigint | string): ChipAmount => {
  if (typeof value === 'string') return parseChips(value);
  assertChipAmount(value);
  return value;
};

export const serializeChips = (value: ChipAmount): string => {
  assertChipAmount(value);
  return value.toString(10);
};

export const addChips = (left: ChipAmount, right: ChipAmount): ChipAmount => {
  assertChipAmount(left);
  assertChipAmount(right);
  return left + right;
};

export const subtractChips = (left: ChipAmount, right: ChipAmount): ChipAmount => {
  assertChipAmount(left);
  assertChipAmount(right);
  if (right > left) throw new RangeError('CHIP subtraction underflow');
  return left - right;
};
