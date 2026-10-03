# Flopiq

Flopiq is a Stellar-based No-Limit Texas Hold'em cash-game platform.

The project is currently in **Phase 1 — Small Playable Prototype**. The immediate goal is the smallest genuinely playable two-player hand from start to finish while keeping Poker Core authoritative, deterministic, infrastructure-independent, and suitable for the later production architecture.

## Current prototype foundation

The repository currently includes deterministic Poker Core primitives for:

- integer-only CHIP accounting and invariants,
- betting actions and no-limit raise/all-in rules,
- main/side-pot construction,
- table positions and heads-up action order,
- forced SB/BB preflop initialization,
- street progression,
- a replaceable deterministic local dealer,
- Texas Hold'em hand ranking.

The next prototype work is to connect these primitives into winner resolution, pot awarding, complete hand lifecycle, and end-to-end heads-up hand tests.

Production networking, wallet integration, Stellar/Soroban settlement, persistence, MPC, and polished UI are intentionally deferred until their roadmap phase.

## Approved build order

1. Small Playable Prototype
2. Soroban
3. Wallet + Stellar CHIP
4. Minimal Database
5. MPC
6. Bind MPC + Poker + Settlement
7. First Product Version

This order changes **implementation sequence**, not the approved production security architecture. Surrounding infrastructure may be simplified or deferred to reach a playable product faster, but Poker Core correctness, financial invariants, and architectural boundaries must not be compromised.

## Requirements

- Node.js 24
- pnpm 12

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Architecture, implementation order, security constraints, and cost/data strategy are documented in [`docs/`](docs/).
