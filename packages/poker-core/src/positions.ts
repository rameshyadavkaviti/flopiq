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

export const nextOccupiedSeat = (
  occupiedSeats: readonly number[],
  afterSeat: number,
): number => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  if (!Number.isSafeInteger(afterSeat) || afterSeat < MIN_SEAT || afterSeat > MAX_SEAT) {
    throw new Error('Reference seat must be an integer between 0 and 8');
  }

  return seats.find((seat) => seat > afterSeat) ?? seats[0]!;
};

export const nextButtonSeat = (
  occupiedSeats: readonly number[],
  currentButtonSeat: number,
): number => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  requireOccupiedSeat(seats, currentButtonSeat);
  return seats.find((seat) => seat > currentButtonSeat) ?? seats[0]!;
};

export const assignHandPositions = (
  occupiedSeats: readonly number[],
  buttonSeat: number,
): HandPositions => {
  const seats = normalizeOccupiedSeats(occupiedSeats);
  requireOccupiedSeat(seats, buttonSeat);

  if (seats.length === 2) {
    const bigBlindSeat = seats.find((seat) => seat !== buttonSeat)!;
    return Object.freeze({
      buttonSeat,
      smallBlindSeat: buttonSeat,
      bigBlindSeat,
      preflopFirstSeat: buttonSeat,
      postflopFirstSeat: bigBlindSeat,
    });
  }

  const smallBlindSeat = seats.find((seat) => seat > buttonSeat) ?? seats[0]!;
  const bigBlindSeat = seats.find((seat) => seat > smallBlindSeat) ?? seats[0]!;
  const preflopFirstSeat = seats.find((seat) => seat > bigBlindSeat) ?? seats[0]!;
  const postflopFirstSeat = smallBlindSeat;

  return Object.freeze({
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    preflopFirstSeat,
    postflopFirstSeat,
  });
};
