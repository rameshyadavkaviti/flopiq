# Flopiq

Flopiq is a Stellar-based No-Limit Texas Hold'em cash-game platform.

**Phase 1 — Small Playable Prototype is complete.** The prototype keeps Poker Core authoritative, deterministic, infrastructure-independent, and ready for the later production architecture. Phase 2 (Soroban) has not started in this phase-completion checkpoint.

## Current prototype

The repository now includes:

- integer-only `bigint` CHIP accounting and conservation invariants,
- no-limit betting actions, minimum raises, and all-in reopening rules,
- main/side-pot construction,
- deterministic positions and heads-up action order,
- forced SB/BB preflop initialization,
- flop/turn/river street progression,
- a replaceable deterministic local dealer,
- seven-card Texas Hold'em hand ranking,
- terminal-fold and showdown winner resolution,
- split-pot and odd-CHIP payout allocation,
- complete hand lifecycle through settlement,
- deterministic next-hand/button progression,
- a thin two-player local playable adapter.

Poker Core does not depend on the local dealer. The adapter explicitly coordinates dealer street transitions and supplies evaluated showdown ranks back to Poker Core, so the prototype dealer can later be replaced by the approved MPC/fairness layer without moving poker-rule authority.

## Run the local prototype

Requirements:

- Node.js 24
- pnpm 12

Install and verify:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Start the deterministic two-player terminal table:

```bash
pnpm play:local
```

Supported player commands are:

```text
fold
check
call
bet 20
raise 40
all-in
cards
next
quit
```

The local adapter intentionally uses explicit deterministic decks. It is a Phase 1 development harness, not production randomness, networking, privacy, wallet, or settlement infrastructure. The current preflop initializer also rejects a participant whose stack is smaller than the forced blind they must post; short-blind bring-in semantics remain an explicit future hardening decision.

## Approved build order

1. Small Playable Prototype
2. Soroban
3. Wallet + Stellar CHIP
4. Minimal Database
5. MPC
6. Bind MPC + Poker + Settlement
7. First Product Version

This order changes **implementation sequence**, not the approved production security architecture. Production networking, wallet integration, Stellar/Soroban settlement, persistence, MPC, and polished UI remain deferred until their roadmap phase.

Architecture, implementation order, security constraints, and cost/data strategy are documented in [`docs/`](docs/).
