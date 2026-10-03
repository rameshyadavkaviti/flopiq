# Small Playable Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let two local players complete deterministic No-Limit Texas Hold'em hands from blind posting through settlement and the next hand while Poker Core remains the sole rules authority.

**Architecture:** Extend `packages/poker-core` with focused pure modules for street progression, cards/dealing, hand ranking, and whole-hand state transitions. A final thin local adapter supplies a deterministic deck and player intents; it displays core state but never computes legal actions, pots, winners, or balances.

**Tech Stack:** Node.js 24, TypeScript 5.9 strict ESM, Vitest, existing bigint CHIP helpers.

**Spec:** `docs/ARCHITECTURE.md`, `docs/COST_AND_DATA_STRATEGY.md`, `docs/IMPLEMENTATION_PLAN.md`, and the approved Small Playable Prototype roadmap in the task request.

## Global Constraints

- Poker Core is deterministic, replayable, immutable to callers, and free of I/O, clock reads, and randomness.
- All CHIP accounting uses `bigint`; no authoritative game rule moves into the local adapter.
- Preserve the existing 2–9 seat, betting, reopening, and side-pot behavior.
- No wallet, Stellar, Soroban, database, MPC, production networking, or production UI.
- Each slice receives full typecheck, lint, and test verification plus its own reviewed PR before the next slice.

## Review Focus

- A street cannot advance before its betting round is complete.
- Folded/all-in state and total hand commitments survive street resets without CHIP loss.
- Duplicate cards, invalid decks, and dealing beyond the deck are rejected atomically.
- Seven-card ranking handles ties, wheel straights, board plays, and exact category tie-breaks.
- Fold and showdown settlement conserve CHIP, preserve side pots, and define deterministic odd CHIP ownership.

---

### Task 1: Street progression

**Files:**
- Create: `packages/poker-core/src/streets.ts`
- Create: `packages/poker-core/test/streets.test.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: `BettingRoundState`, `HandPositions`, and existing invariant constructors.
- Produces: `PokerStreet` and `createNextStreetBettingRound(previous, firstToActSeat)`.

- [ ] Write failing tests for preflop-to-flop reset, heads-up postflop order, folded/all-in skipping, automatic completion when no decisions remain, conservation, immutability, and invalid transitions.
- [ ] Run `npm test -- packages/poker-core/test/streets.test.ts` and confirm the missing API fails.
- [ ] Implement the minimal pure street-round initializer, preserving `handCommitted`, resetting street-only fields, and rejecting incomplete rounds or invalid first actors.
- [ ] Run focused tests, then `npm run typecheck`, `npm run lint`, and `npm test`.
- [ ] Commit, push, open a PR, inspect CI/reviews, fix only confirmed findings, and merge when clean.

### Task 2: Deterministic cards and local dealer boundary

**Files:**
- Create: `packages/poker-core/src/cards.ts`
- Create: `packages/poker-core/src/dealer.ts`
- Create: `packages/poker-core/test/cards.test.ts`
- Create: `packages/poker-core/test/dealer.test.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: ordered active seats and a caller-supplied complete deck.
- Produces: validated card/deck types and deterministic hole/flop/turn/river deal transitions, including standard burn cards.

- [ ] Write failing tests for canonical cards, duplicate/malformed decks, heads-up dealing order, burns, board order, immutability, and replay equality.
- [ ] Implement validation plus a pure dealer that never creates or randomizes a deck.
- [ ] Run focused and full verification.
- [ ] Commit, push, review, and merge as an independent PR.

### Task 3: Texas Hold'em hand ranking

**Files:**
- Create: `packages/poker-core/src/hand-ranking.ts`
- Create: `packages/poker-core/test/hand-ranking.test.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: exactly two private cards and five board cards.
- Produces: a deterministic comparable best-five hand rank without CHIP or winner allocation.

- [ ] Write failing category, kicker, wheel, board-play, tie, and exhaustive seven-card selection tests.
- [ ] Implement auditable five-card ranking and choose the maximum of all 21 five-card combinations.
- [ ] Run focused and full verification.
- [ ] Commit, push, review, and merge as an independent PR.

### Task 4: Hand lifecycle and settlement

**Files:**
- Create: `packages/poker-core/src/hand.ts`
- Create: `packages/poker-core/src/settlement.ts`
- Create: `packages/poker-core/test/hand.test.ts`
- Create: `packages/poker-core/test/settlement.test.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: hand start configuration, validated player actions, deterministic dealer transitions, hand ranks, and `constructPots`.
- Produces: immutable hand states/events through start, streets, terminal fold/showdown, pot award, completion, and next-hand configuration.

- [ ] Write failing regression hands for fold preflop, checked streets, bet/call streets, all-in runout, tie, side pots, and next-button hand start.
- [ ] Define and test the standard deterministic odd-CHIP rule before implementing payout allocation.
- [ ] Implement the smallest lifecycle reducer and settlement functions; no SHOW/MUCK UI workflow beyond what correct award calculation requires.
- [ ] Run focused and full verification, including conservation from starting to ending stacks.
- [ ] Commit, push, review, and merge as one or two PRs if lifecycle and settlement review independently.

### Task 5: Thin local playable adapter

**Files:**
- Create: `apps/local-table/package.json`
- Create: `apps/local-table/src/index.ts`
- Create: `apps/local-table/test/local-table.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: public Poker Core hand APIs and a fixed/explicit deterministic deck.
- Produces: a local two-player command loop that renders state and forwards player intents to Poker Core.

- [ ] Write an end-to-end scripted test covering one full hand and starting the next hand.
- [ ] Implement only input parsing and presentation; derive all legal outcomes from Poker Core.
- [ ] Verify the scripted flow plus full repository checks.
- [ ] Commit, push, review, and merge; stop before Soroban.
