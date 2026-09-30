import type { ChipAmount } from './money.js';

export type PokerAction =
  | { readonly type: 'fold'; readonly playerId: string }
  | { readonly type: 'check'; readonly playerId: string }
  | { readonly type: 'call'; readonly playerId: string }
  | { readonly type: 'bet'; readonly playerId: string; readonly amount: ChipAmount }
  | { readonly type: 'raise'; readonly playerId: string; readonly to: ChipAmount }
  | { readonly type: 'all-in'; readonly playerId: string };

export class PokerRuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PokerRuleError';
  }
}
