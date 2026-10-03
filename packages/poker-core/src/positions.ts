export interface HandPositions {
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly preflopFirstSeat: number;
  readonly postflopFirstSeat: number;
}

const MIN_SEAT = 0;
const MAX_SEAT = 8;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;

const normalizeOccupiedSeats = (occupiedSeats: readonly number[]): readonly number[] => {
  if (occupiedSeats.length < MIN_PLAYERS || occupiedSeats.length > MAX_PLAYERS) {
    throw new Error('Hand positions require between 2 and 9 occupied seats');
  }

  const seen = new Set<number>();
  for (const seat of occupiedSeats) {
    if (!Number.isSafeInteger(seat) || seat < MIN_SEAT || seat > MAX_SEAT) {
      throw new Error('Occupied seats must be integers between 0 and 8');
    }
    if (seen.has(seat)) throw new Error('Occupied seats must be unique');
    seen.add(seat);
  }

  return Object.freeze([...occupiedSeats].sort((left, right) => left - right));
};

const requireOccupiedSeat = (occupiedSeats: readonly number[], seat: number): void => {
  if (!occupiedSeats.includes(seat)) {
    throw new Error('Button seat must be occupied');
  }
};

const firstOccupiedSeat = (occupiedSeats: readonly number[]): number => {
  const first = occupiedSeats[0];
  if (first === undefined) throw new Error('At least one occupied seat is required');
  return first;
};

const nextFromNormalizedSeats = (
  occupiedSeats: readonly number[],
  afterSeat: number,
): number => occupiedSeats.find((seat) => seat > afterSeat) ?? firstOccupiedSeat(occupiedSeats);

export const nextOccupiedSeat = (
  occupiedSeats: readonly number[],
  afterSeat: number,
): number => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  if (!Number.isSafeInteger(afterSeat) || afterSeat < MIN_SEAT || afterSeat > MAX_SEAT) {
    throw new Error('Reference seat must be an integer between 0 and 8');
  }

  return nextFromNormalizedSeats(seats, afterSeat);
};

export const nextButtonSeat = (
  occupiedSeats: readonly number[],
  currentButtonSeat: number,
): number => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  requireOccupiedSeat(seats, currentButtonSeat);
  return nextFromNormalizedSeats(seats, currentButtonSeat);
};

export const assignHandPositions = (
  occupiedSeats: readonly number[],
  buttonSeat: number,
): HandPositions => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  requireOccupiedSeat(seats, buttonSeat);

  if (seats.length === 2) {
    const bigBlindSeat = nextFromNormalizedSeats(seats, buttonSeat);
    return Object.freeze({
      buttonSeat,
      smallBlindSeat: buttonSeat,
      bigBlindSeat,
      preflopFirstSeat: buttonSeat,
      postflopFirstSeat: bigBlindSeat,
    });
  }

  const smallBlindSeat = nextFromNormalizedSeats(seats, buttonSeat);
  const bigBlindSeat = nextFromNormalizedSeats(seats, smallBlindSeat);
  const preflopFirstSeat = nextFromNormalizedSeats(seats, bigBlindSeat);
  const postflopFirstSeat = smallBlindSeat;

  return Object.freeze({
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    preflopFirstSeat,
    postflopFirstSeat,
  });
};
