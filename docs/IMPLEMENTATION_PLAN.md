# Flopiq Implementation Plan v2

Status: **Approved playable-first execution plan**

Depends on:
- `docs/ARCHITECTURE.md`
- `docs/COST_AND_DATA_STRATEGY.md`

This document defines the current implementation order. The production architecture in `ARCHITECTURE.md` remains the target architecture.

---

## 1. Execution principle

Reach a genuinely playable product as early as possible without weakening the parts that are expensive or dangerous to rewrite later.

Therefore:

- simplify or defer surrounding infrastructure,
- keep Poker Core production-quality and authoritative,
- preserve boundaries between poker rules, orchestration, persistence, dealing/fairness, and financial settlement,
- use small independently reviewable changes,
- do not introduce production infrastructure before its phase merely to imitate the final deployment.

The current build order is:

```text
1. Small Playable Prototype
2. Soroban
3. Wallet + Stellar CHIP
4. Minimal Database
5. MPC
6. Bind MPC + Poker + Settlement
7. First Product Version
```

A later phase must not be pulled forward unless it is required to validate an earlier architectural boundary.

---

## 2. Phase 1 — Small Playable Prototype

### Goal

Two players can complete a full No-Limit Texas Hold'em hand:

```text
hand start
→ hole cards
→ blinds
→ preflop
→ flop
→ turn
→ river
→ showdown or fold
→ winner resolution
→ pot award
→ hand complete
→ next hand
```

The prototype may use a deterministic local dealer and developer-facing harness. It does not require wallet, Stellar, Soroban, database, MPC, production networking, or polished UI.

### Non-negotiable properties

Poker Core must remain:

- deterministic,
- side-effect free or near-pure,
- independent of UI, database, network, wallet, Stellar, Soroban, and MPC implementation,
- integer-only for CHIP,
- protected by conservation/accounting invariants,
- replayable from explicit canonical inputs.

Poker Core must not depend on:

- wall-clock time,
- database timing,
- network state,
- mutable global state,
- uncontrolled randomness.

Dealing remains behind a replaceable Dealer boundary. Poker Core must never use `Math.random()` for game fairness.

### Current status

**Phase 1 is complete for the approved Small Playable Prototype scope.**

Completed on `main`:

- bigint CHIP representation and conservation invariants,
- fold/check/call/bet/raise/all-in reducer,
- minimum-raise and short-all-in reopening behavior,
- deterministic main/side-pot construction,
- deterministic table positions and heads-up order,
- forced SB/BB preflop initialization,
- deterministic street progression,
- deterministic fixed-deck local dealer,
- deterministic seven-card Texas Hold'em hand ranking,
- terminal-fold and showdown winner resolution,
- split-pot settlement with deterministic odd-CHIP allocation,
- complete hand lifecycle through fold/showdown settlement,
- deterministic next-hand stack carry-forward and button progression,
- end-to-end heads-up integration coverage,
- a thin local two-player playable adapter with a verified terminal entry point.

The local adapter remains outside Poker Core rule authority. It supplies explicit deterministic dealer transitions and ranked showdown inputs; Poker Core remains authoritative for betting legality, lifecycle transitions, winner selection, and CHIP settlement.

### Known prototype limits

- A participant whose stack is smaller than the forced blind they must post is still rejected by the current preflop initializer. Supporting a short big blind correctly requires an explicit bring-in/current-bet model decision rather than weakening the existing betting invariant.
- The local dealer uses caller-supplied deterministic decks. It does not provide production randomness, privacy, or fairness.
- The terminal table is a developer harness, not a production game server or UI.

These limits do not pull later infrastructure phases forward.

### Phase boundary

Do not recreate already-completed Phase 1 slices. **Phase 2 — Soroban is already active and partially implemented on `main`.** Continue to treat Soroban changes as bounded contract tasks with security review; do not restart the phase from its original foundation.

---

## 3. Phase 2 — Soroban

### Goal

Prove the financial custody and settlement boundary independently of production wallet/UI integration.

Implement and test the minimum contract surface needed for:

- table-fund locking,
- safe release,
- replay-resistant hand settlement,
- CHIP conservation,
- rake routing when enabled,
- explicit authorization boundaries.

Target modules remain:

- Cashier,
- TableVault,
- Settlement,
- Treasury/Rake.

Before finalizing contracts, define a canonical settlement payload binding at least:

- protocol version,
- table ID,
- hand ID,
- previous committed table state/version,
- ordered participants,
- starting stacks,
- final stacks,
- rake,
- action transcript digest,
- deal/fairness digest placeholder,
- next state/version.

During this phase, a deterministic/test fairness digest may stand in for the later MPC proof binding. Do not claim production fairness until Phase 6 is complete.

Contract tests precede testnet/mainnet deployment.

### Phase 2 repository foundation

The repository contains:

- `contracts/Cargo.toml` — isolated Rust workspace,
- `contracts/README.md` — workspace rules and planned contract boundaries,
- `docs/SOROBAN_ARCHITECTURE.md` — custody/contract/security boundaries,
- `docs/SETTLEMENT_PROTOCOL.md` — canonical completed-hand settlement payload and invariants.

These files remain the source of truth for the Phase 2 contract boundary. Merged code now includes local/test Soroban financial state transitions and a test-SAC-backed TableVault, but not production custody, final settlement authority, or the complete target contract set.

### Phase 2 implementation status on `main`

This status maps merged repository reality to the original Phase 2 sequence without changing the target architecture:

| Slice | Status | Current merged reality |
| --- | --- | --- |
| 2A. Freeze settlement types + contract workspace | `Implemented` | Rust workspace, shared settlement types, canonical validation, and local contract foundations exist. |
| 2B. TableVault state/custody core | `Partial` | Local/test TableVault supports authenticated allocation, exact test-SAC deposits, version-bound hand lifecycle, conserved settlement, Ready-state full exit, and retained zero-stack redeposit. Production custody/lifecycle remains incomplete. |
| 2C. Settlement replay/version/conservation core | `Partial` | Replay, version, participant/state matching, zero-rake conservation, and settlement commitment behavior are implemented in the local/test contracts; the final production settlement authority is not. |
| 2D. Treasury/Rake boundary | `Not started` | Rake remains disabled at zero and no Treasury/Rake contract boundary is implemented. |
| 2E. Cashier boundary with test asset | `Not started` | No Cashier conversion boundary is implemented. |
| 2F. Cross-contract integration tests | `Partial` | TableVault integrates the shared settlement types and a test SAC locally, but the planned Treasury/Rake/Cashier cross-contract flow does not yet exist. |
| 2G. Testnet deployment after local review | `Deferred` | Current contracts are documented and tested as local/test foundations and are not approved for real funds or production deployment. |

These labels describe implementation status only. They do not declare Phase 2 complete.

---

## 4. Phase 3 — Wallet + Stellar CHIP

### Goal

Connect player ownership and the Stellar asset to the proven financial boundary.

Initial direction:

- Stellar wallet is permanent player identity,
- Albedo is the first wallet,
- use signed, single-use, expiring, domain-separated authentication challenges,
- never request or store wallet secret keys,
- CHIP remains a Stellar asset using its SAC unless a concrete requirement justifies another model,
- cashier conversion remains fixed at 1 XLM = 100 CHIP for the first version.

Financial authorization must remain separate from ordinary application-session authentication.

---

## 5. Phase 4 — Minimal Database

### Goal

Add only the durable state required for recovery, history, identity/session support, and financial/audit references.

Use PostgreSQL first. Redis is not required.

Persist facts rather than repeated derived snapshots:

- player identity,
- table configuration,
- hand identity/start,
- ordered canonical actions,
- final hand result,
- settlement/audit references,
- required public verification metadata.

Recovery should replay canonical actions through Poker Core.

A compact checkpoint may be introduced only if measurement shows replay is a problem.

The database must not become the authority for poker legality or withdrawable on-chain funds.

---

## 6. Phase 5 — MPC

### Goal

Replace the deterministic prototype dealer with a reviewed threshold/MPC fairness implementation without rewriting Poker Core.

Initial security target:

- three dealer nodes,
- one malicious node is insufficient to learn/control the full deck,
- session bound to `hand_id`,
- replay resistance,
- safe abort behavior,
- verifiable public evidence sufficient for settlement binding.

Do not invent a homemade cryptographic protocol.

Use an isolated research/integration spike first. Benchmark at least 2-, 6-, and 9-player flows, failure behavior, proof/verification latency, memory, and on-chain verification cost.

Do not connect real player money to an experimental MPC implementation.

---

## 7. Phase 6 — Bind MPC + Poker + Settlement

### Goal

Make the production security property real.

Conceptually:

```text
hand_id
+ canonical action transcript digest
+ MPC session/proof digest
+ final stack vector
+ rake
        ↓
canonical settlement
        ↓
Soroban validation
```

A normal backend compromise must not be sufficient to:

- fabricate a valid financial settlement,
- manipulate the deck undetectably,
- learn all private cards,
- reuse a settlement for another hand.

This phase requires security-focused review before real-value deployment.

---

## 8. Phase 7 — First Product Version

Integrate the minimum product surface around the validated core:

- authoritative realtime game server,
- WebSocket table coordination,
- timers/time bank and disconnect policies,
- create/join/leave table flow,
- sit-out and rebuy flow,
- wallet/cashier UX,
- hand history,
- SHOW/MUCK UX,
- verification status/details,
- responsive playable UI,
- operational monitoring and backups.

The game server coordinates; it does not duplicate Poker Core rules.

Production UI consumes the same authoritative protocol and state transitions proven in earlier phases.

---

## 9. Data and infrastructure rules across all phases

- CHIP uses integer arithmetic only.
- Store canonical actions/facts, not full snapshots after every action.
- PostgreSQL is the required durable application database once persistence begins.
- Redis remains optional until multi-instance coordination actually needs it.
- Keep recent hand history hot; archive bulky old transcripts/proofs when justified.
- Never log secrets, private MPC shares, or unrevealed private cards.
- Prefer portable infrastructure primitives.
- Measure before scaling.

See `docs/COST_AND_DATA_STRATEGY.md` for the detailed data/cost policy.

---

## 10. Work-unit rule

Every implementation task, whether performed by Work or a complementary development session, must have:

- one bounded goal,
- explicit scope and non-goals,
- relevant invariants,
- required tests,
- validation with tests + typecheck + lint,
- a small reviewable branch/PR.

Before implementation, inspect current `main`, recent commits, open/recent PRs, CI, and relevant architecture documents. Repository reality wins over stale conversation context.

Parallel agents must not knowingly modify the same branch/PR or overlapping implementation area.

---

## 11. Current work boundary

Phase 1 has reached its approved completion condition, and Phase 2 is already partially implemented on `main`. The original Phase 2A foundation is no longer an upcoming task and must not be recreated.

Before assigning further Soroban implementation work:

1. inspect current `main`, open PRs, and CI,
2. use the Phase 2 status table above to distinguish merged implementation from target architecture,
3. read `docs/SOROBAN_ARCHITECTURE.md` and `docs/SETTLEMENT_PROTOCOL.md`,
4. verify the then-current Stellar CLI, Soroban SDK, and target network protocol before version-specific work,
5. keep Poker Core unchanged unless a genuine protocol contradiction is discovered,
6. continue using local contract tests before any network deployment.

This document intentionally does **not** select the next production financial feature. Any next Soroban slice must be chosen from current repository reality and the approved architecture, with production custody, wallet/CHIP integration, final settlement authority, MPC/fairness binding, and mainnet deployment still treated as unfinished or deferred where applicable.
