import type { ChipAmount } from './money.js';

interface PlayerEvent {
  readonly playerId: string;
  readonly seat: number;
}

export type PokerEvent =
  | ({ readonly type: 'PLAYER_FOLDED' } & PlayerEvent)
  | ({ readonly type: 'PLAYER_CHECKED' } & PlayerEvent)
  | ({
      readonly type: 'PLAYER_CALLED';
      readonly amount: ChipAmount;
      readonly toAmount: ChipAmount;
    } & PlayerEvent)
  | ({ readonly type: 'PLAYER_BET'; readonly amount: ChipAmount } & PlayerEvent)
  | ({
      readonly type: 'PLAYER_RAISED';
      readonly amount: ChipAmount;
      readonly toAmount: ChipAmount;
      readonly raiseSize: ChipAmount;
      readonly fullRaise: boolean;
    } & PlayerEvent)
  | ({
      readonly type: 'PLAYER_ALL_IN';
      readonly kind: 'call' | 'bet' | 'raise';
      readonly toAmount: ChipAmount;
    } & PlayerEvent)
  | { readonly type: 'BETTING_ROUND_COMPLETE'; readonly actionSequence: number };
