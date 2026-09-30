# Flopiq Implementation Plan v1

Status: **Ready for implementation**
Depends on:
- `docs/ARCHITECTURE.md`
- `docs/COST_AND_DATA_STRATEGY.md`

This plan defines the most efficient build order for Flopiq while preserving the security architecture.

---

## 1. Decision: Where We Start

Start with a **small TypeScript monorepo and a standalone deterministic poker engine**.

Do **not** start with:
- polished frontend,
- database schema,
- Redis,
- Soroban contracts,
- CHIP issuance,
- production MPC,
- paid hosting.

Reason: every one of those systems depends on exact poker state transitions and settlement semantics. Building them before the Poker Core is frozen creates expensive rewrites.

The first production-quality component should be:

```text
packages/poker-core
```

It must be independently testable and have no dependency on:
- Next.js,
- WebSockets,
- PostgreSQL,
- Stellar,
- Soroban,
- MPC implementation.

---

## 2. Initial Toolchain

Recommended baseline:

- Node.js 24 LTS
- pnpm 12 workspace
- TypeScript 5.9 with strict settings
- Vitest
- GitHub Actions CI
- ESM modules

Why:
- Node 24 is an active LTS line.
- pnpm workspaces keep a future multi-app/multi-package repo efficient.
- Vitest supports current Node and is fast for deterministic unit/property-style testing.
- TypeScript strict mode helps keep protocol/state errors visible early.

Do not chase the newest Current Node release for this project. Prefer LTS.

---

## 3. Initial Repository Shape

Create only what is needed now:

```text
flopiq/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  .editorconfig
  .github/
    workflows/
      ci.yml

  packages/
    poker-core/
      package.json
      tsconfig.json
      src/
        index.ts
        money.ts
        types.ts
        state.ts
        actions.ts
        betting.ts
        pots.ts
        showdown.ts
        invariants.ts
      test/

  docs/
    ARCHITECTURE.md
    COST_AND_DATA_STRATEGY.md
    IMPLEMENTATION_PLAN.md
```

Do not create empty apps/services/contracts folders simply to make the repository look complete. Add them when their implementation phase begins.

---

## 4. Money Representation

All money/chip math must use integer values.

Recommended TypeScript representation:

```ts
type ChipAmount = bigint
```

Never use JavaScript `number` for:
- stacks,
- bets,
- pots,
- rake,
- cashier conversion,
- settlement.

The Stellar integration layer will later define the exact conversion between CHIP protocol units and the asset's 7-decimal Stellar representation.

The Poker Core should not know about XLM or Stellar base units.

---

## 5. Poker Core API

Target shape:

```ts
reduce(state, action) -> {
  state: nextState,
  events: PokerEvent[]
}
```

Properties:

- deterministic,
- side-effect free,
- no I/O,
- no clock reads,
- no randomness,
- no database,
- no blockchain calls.

External systems supply:
- actions,
- timeout actions,
- dealer/card events.

Poker Core decides whether an action is legal and what deterministic state follows.

---

## 6. Rules to Implement First

Order matters.

### Milestone 1A — Money and invariants

Implement:
- nonnegative bigint CHIP,
- safe add/subtract helpers,
- canonical serialization,
- chip conservation assertions.

Acceptance:
- no floating-point path exists.

### Milestone 1B — Betting reducer

Implement:
- fold,
- check,
- call,
- bet,
- raise,
- all-in,
- minimum raise,
- short all-in,
- reopening rules,
- deterministic next actor.

Acceptance:
- invalid moves are rejected without mutating state.

### Milestone 1C — Pots

Implement:
- main pot,
- multiple side pots,
- folded-player contribution handling,
- simultaneous all-ins,
- deterministic pot construction.

Acceptance:
- total pot contributions equal committed chips.

### Milestone 1D — Table/action order

Implement:
- 2–9 seats,
- dealer/button movement,
- SB/BB,
- heads-up exception,
- optional straddle,
- preflop/postflop action order.

### Milestone 1E — Streets and showdown

Implement:
- preflop,
- flop,
- turn,
- river,
- terminal fold,
- showdown eligibility,
- SHOW/MUCK state,
- all-in terminal flow.

Do not put cryptographic dealing inside Poker Core.

---

## 7. Dealer Boundary

Create a protocol boundary before implementing MPC.

Conceptually:

```ts
interface Dealer {
  beginHand(...)
  dealHoleCards(...)
  revealFlop(...)
  revealTurn(...)
  revealRiver(...)
  revealShowdown(...)
}
```

For early tests use:
- deterministic seeded/test dealer,
- fixed-deck fixtures.

Later replace the adapter with MPC without changing poker betting logic.

Never allow Poker Core to call `Math.random()`.

---

## 8. Testing Requirement Before Backend Work

The Poker Core is not considered ready because a few example games pass.

It should include:
- unit tests,
- regression fixtures,
- generated/property-style scenario tests where useful,
- invariant checks after every accepted action.

Mandatory scenarios include:
- heads-up all-in,
- 9-player hand,
- multiple folded contributors,
- 3+ side pots,
- short all-in that does not reopen action,
- full all-in that does reopen action,
- exact-stack call,
- zero-stack player,
- straddle action order,
- odd payout remainder rule once defined,
- conservation after every action and hand.

CI must run on every push/PR:
- typecheck,
- tests,
- lint.

---

## 9. Phase 2 — Headless Game Server

Only after Poker Core is stable, add:

```text
apps/game-server
packages/protocol
```

Recommended server direction:
- Node.js + TypeScript
- Fastify for HTTP boundary
- `ws` / Fastify WebSocket integration for realtime transport
- runtime validation of client messages
- one authoritative sequence per table

Responsibilities:
- table lifecycle,
- sessions,
- timers,
- 15s + time bank,
- disconnect policy,
- sit out next hand,
- leave-after-hand,
- manual rebuy,
- auto-rebuy,
- multi-table connections,
- action sequencing.

The server calls Poker Core; it does not duplicate poker rules.

---

## 10. Phase 3 — Persistence

Add PostgreSQL only when the headless server needs durable recovery/history.

Use local PostgreSQL first.

Do not pay for managed PostgreSQL during early development unless remote collaboration requires it.

Recommended data access:
- thin typed SQL layer,
- Kysely + `pg` is preferred for predictable SQL and explicit storage control,
- schema migrations stored in Git.

Persist canonical facts:
- table config,
- hand start,
- ordered actions,
- hand result,
- settlement/audit references.

Do not persist full table snapshots after every action.

Recovery:
- replay canonical actions through Poker Core.

A compact street-boundary checkpoint can be added later only if profiling shows a recovery problem.

---

## 11. Phase 4 — Minimal Developer UI

Add:

```text
apps/web
```

Use:
- Next.js 16.x, current patched version at implementation time,
- TypeScript,
- Tailwind.

This UI is not the final visual design.

Purpose:
- create/join local tables,
- display stack/pot,
- perform actions,
- test reconnect,
- test 2–9 players,
- inspect hand log.

Do not spend significant time on animation/design yet.

---

## 12. Phase 5 — Stellar Wallet Authentication

Initial wallet:
- Albedo.

Authentication:
- request wallet public key,
- server issues single-use expiring challenge,
- player signs challenge,
- backend verifies signature,
- backend creates short-lived session.

Requirements:
- domain-separated challenge,
- nonce,
- expiry,
- one-time consumption,
- no secret keys.

Financial Soroban authorization remains separate from web login.

Later, consider Stellar Wallets Kit to expand beyond Albedo without redesigning the app.

---

## 13. Phase 6 — CHIP and Soroban Financial Layer

Target current Stellar Mainnet protocol/toolchain explicitly when this phase begins.

As of the architecture research checkpoint:
- Mainnet is Protocol 26.
- Testnet is Protocol 27.

Do not silently mix Testnet-only protocol assumptions into Mainnet contracts.

CHIP direction:
- issue CHIP as a Stellar asset,
- deploy/use its Stellar Asset Contract (SAC),
- do not build a custom token contract without a concrete requirement.

Contracts:
- Cashier,
- TableVault,
- Settlement,
- Treasury/Rake.

Build contracts as a Rust workspace using the Stellar CLI recommended layout.

Contract tests must precede testnet deployment.

---

## 14. Settlement Boundary

Before contracts are finalized, define one canonical settlement payload.

It should bind at minimum:
- protocol version,
- table_id,
- hand_id,
- previous committed table state/version,
- ordered participant IDs/addresses,
- starting stacks,
- final stacks,
- rake,
- action transcript digest,
- MPC/deal verification digest,
- next state/version.

The Settlement contract must not trust a free-form backend result.

The payload format becomes a protocol artifact shared by:
- game server,
- settlement coordinator,
- MPC/proof layer,
- contracts,
- audit UI.

---

## 15. Phase 7 — MPC/ZK Research Spike

Do not immediately write a custom cryptographic protocol.

The most relevant existing Stellar reference is the current StellPoker approach:
- 3 MPC nodes,
- REP3 secret sharing,
- TACEO coNoir,
- UltraHonk proofs,
- on-chain verification using Stellar BN254/Poseidon primitives.

This closely matches Flopiq's requirement that one malicious node must not reveal/control the deck.

However:
- StellPoker currently targets up to 6 players,
- its betting architecture is more on-chain than Flopiq's,
- Flopiq targets 2–9 players,
- TACEO marks coSNARK tooling experimental/unaudited.

Therefore create an isolated spike:

```text
spikes/mpc-dealer
```

Goals:
1. reproduce a 3-node local REP3 deal,
2. prove privacy against one node,
3. bind session to `hand_id`,
4. benchmark 2, 6, and 9-player deal/reveal flow,
5. measure proof latency and memory,
6. test one-node failure/abort,
7. determine on-chain verification cost,
8. document exact trust assumptions.

Do not connect real player money during this spike.

Only after the spike succeeds do we choose the production MPC implementation.

---

## 16. Why MPC Is Not Phase 1

MPC is one of the highest-risk engineering areas in Flopiq.

Starting there creates two problems:
- poker rules remain unstable while expensive cryptographic code is being written,
- an experimental crypto stack becomes coupled to the entire application.

A Dealer interface lets us progress in parallel without weakening the final architecture.

---

## 17. Phase 8 — Bind Fairness to Settlement

After both Soroban settlement and MPC are proven independently:

```text
hand_id
  + action transcript digest
  + MPC session/proof digest
  + final stack vector
  + rake
        |
        v
canonical settlement
        |
        v
Soroban validation
```

The backend alone must not be sufficient to authorize arbitrary settlement.

This is the point where the architecture's primary security property becomes real.

---

## 18. Phase 9 — Production UI

Only now invest heavily in:
- table visuals,
- animation,
- responsive layout,
- hand history UX,
- SHOW/MUCK UX,
- verification details,
- wallet/cashier experience,
- multi-table UX,
- accessibility.

The visual layer must consume the same protocol as the minimal developer UI.

---

## 19. Hosting Sequence

### Development
- local Node,
- local PostgreSQL,
- local three-process MPC,
- Stellar local/testnet,
- no Redis,
- no paid services required.

### Private integration
- one inexpensive allowed EU VPS if needed,
- external encrypted backups,
- testnet only.

### Public/real-value
- durable PostgreSQL,
- separate game server,
- 3 MPC nodes across independent failure/security domains,
- object archive/backups,
- monitoring,
- Redis only if multi-instance coordination requires it.

Do not separate everything early just to mimic production.

---

## 20. Redis Decision

Redis is not a Phase 1 requirement.

Add it only when:
- multiple game-server instances need pub/sub,
- cross-instance presence/reconnect state is required,
- distributed rate limiting/leases are required.

It must never be the sole copy of:
- balances,
- hand history,
- settlements.

---

## 21. Cost-Efficient Data Rules

Carry these rules into implementation:

1. store canonical actions, not repeated state snapshots,
2. reference players by internal IDs in hot relational rows,
3. use BIGINT for token/chip values,
4. keep JSONB for flexible/versioned metadata only,
5. create indexes from real query patterns,
6. keep latest 20 player hands hot,
7. archive bulky old transcripts/proofs to object storage,
8. use short log retention for routine traffic,
9. never store secrets/private shares in application logs,
10. measure before scaling.

---

## 22. Immediate First Work Task

The first autonomous implementation task should be limited to:

> Bootstrap the TypeScript workspace and implement the first production-quality version of `packages/poker-core` foundation: bigint money type, core state/types, action model, betting reducer, invariants, and exhaustive tests for fold/check/call/bet/raise/all-in including short-all-in reopening behavior. Do not add frontend, database, Stellar, Soroban, wallet, WebSocket, or MPC code.

Definition of done:
- Node 24 / pnpm workspace boots cleanly,
- TypeScript strict compilation passes,
- Vitest suite passes,
- CI runs typecheck + tests + lint,
- all accepted actions preserve chip conservation,
- invalid actions cannot mutate state,
- no floating-point chip representation exists,
- architecture docs remain unchanged unless an implementation contradiction is discovered.

This is the best first implementation slice because it is independently useful and every later Flopiq component depends on it.

---

## 23. Second Work Task

After review of the first task:

- finish side-pot construction,
- table/button/blind/straddle action order,
- heads-up rules,
- streets,
- showdown state,
- SHOW/MUCK state,
- 2–9 player scenario tests.

Only after this should the realtime server start.

---

## 24. Rule for Future Work Tasks

Each Work task should have:
- one bounded architecture goal,
- explicit files/components in scope,
- explicit non-goals,
- security invariants,
- tests required for completion.

Avoid prompts such as "build Flopiq".

Small, verifiable slices are faster overall because security-sensitive mistakes are caught before they spread across contracts, databases, MPC and UI.
