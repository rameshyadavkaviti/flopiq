# Flopiq Soroban Architecture

Status: **Phase 2 approved boundary**
Scope: financial custody and settlement contracts only

This document narrows the production architecture in `ARCHITECTURE.md` into the implementation boundary for Phase 2.

Phase 2 proves the on-chain custody and settlement model **before** production wallet/CHIP integration and before MPC is connected.

---

## 1. Security objective

A normal application backend must not be able to unilaterally steal table funds, replay an old hand settlement, or apply a settlement to the wrong table/hand/state.

Phase 2 must establish:

- isolated table custody,
- explicit authorization,
- monotonic/replay-resistant settlement,
- CHIP conservation,
- safe release rules,
- auditable state transitions,
- an authorization boundary that can later be bound to MPC/fairness evidence without redesigning Poker Core.

Phase 2 does **not** claim production card fairness. The real MPC/fairness binding is Phase 6.

---

## 2. Contract boundaries

### TableVault

Owns/controls table funds.

Responsibilities:

- accept authorized table buy-in deposits,
- isolate balances by at least `(table_id, player)`,
- track the committed table state/version,
- prevent withdrawal of funds that are still committed to an active hand,
- apply only valid Settlement-authorized balance transitions,
- release eligible table balances safely,
- prevent one table from affecting another table's funds.

The database is never the source of truth for withdrawable vault funds.

### Settlement

Validates and applies one canonical completed-hand transition.

Responsibilities:

- accept the canonical settlement payload,
- bind settlement to one `table_id` and one globally unique `hand_id`,
- require the expected previous table state/version,
- reject replay,
- enforce participant and amount validity,
- enforce CHIP conservation,
- enforce allowed rake,
- advance the table state/version exactly once,
- emit auditable settlement events.

Settlement must not accept an unconstrained statement equivalent to:

> the backend says player X won Y.

### Treasury / Rake

Separates platform funds from player funds.

Responsibilities:

- receive only authorized rake,
- account for rake independently from player balances,
- expose auditable events/state,
- never become an alternate path for arbitrary player-fund withdrawal.

Rake policy parameters remain deterministic and versioned.

### Cashier

Owns the XLM ↔ CHIP conversion boundary.

Responsibilities when implemented:

- enforce the configured fixed cashier rate,
- verify treasury/liquidity constraints,
- prevent replay,
- perform integer-safe conversion,
- emit auditable conversion events.

Phase 2 may prove this boundary with a test/mock token setup. Production CHIP/SAC wiring belongs to Phase 3.

---

## 3. Contract interaction model

Conceptually:

```text
Player
  │
  │ authorized deposit / release
  ▼
TableVault
  │
  │ table state + locked balances
  ▼
Settlement
  │
  │ validated completed-hand transition
  ├──────────────► TableVault balance update
  │
  └──────────────► Treasury/Rake
```

Cashier remains a separate conversion boundary:

```text
XLM ⇄ Cashier ⇄ CHIP/SAC
```

Do not combine all responsibilities into one giant contract merely for convenience.

---

## 4. State isolation

At minimum, on-chain table funds must be isolated by:

```text
(table_id, player_address)
```

Each table also has a monotonic committed state/version.

A settlement is valid only against the exact previous version it declares.

Example:

```text
table_id = T
previous_version = 41
hand_id = H
next_version = 42
```

After the transition commits, another payload claiming `previous_version = 41` must fail.

A `hand_id` that has already settled must never settle again.

---

## 5. Amount domains

Poker Core uses deterministic integer CHIP accounting and must remain unaware of Stellar/SAC base-unit representation.

Soroban token interfaces operate in chain token units.

Therefore Phase 2 must keep these domains explicit:

```text
Poker Core CHIP units
        │
        │ explicit adapter / conversion
        ▼
Stellar asset contract units
```

Do not silently assume they are numerically identical.

The exact CHIP ↔ SAC base-unit conversion is finalized in Phase 3 when the production CHIP asset is wired.

Settlement payload fields and contract storage must use one clearly documented amount domain per interface.

---

## 6. Authorization boundary

Phase 2 must make authorization explicit but must not prematurely freeze the final MPC/threshold scheme.

Rules:

- player-originated deposit/release operations require the relevant player authorization where appropriate,
- settlement execution must use a narrowly scoped authorization path,
- a development/test authorization mechanism must not be presented as production security,
- the final design must allow Phase 6 to bind settlement authorization to the approved fairness/settlement evidence,
- no normal backend signing key should become an irreversible single point of financial authority.

Any signed settlement authorization must be domain-separated by at least:

- network,
- settlement contract identity,
- protocol version,
- table ID,
- hand ID,
- previous state/version.

---

## 7. Failure and replay rules

Contracts must reject:

- duplicate `hand_id`,
- stale previous state/version,
- non-monotonic next version,
- duplicate participants,
- negative amounts,
- amount-vector length mismatches,
- participant mismatches with the active table state,
- conservation failures,
- rake above the configured allowance,
- settlement for the wrong table,
- unauthorized release,
- any transition that would cause a player/table balance to go negative.

A failed contract invocation must not partially mutate the financial state.

---

## 8. Phase 2 test strategy

Before testnet deployment, contract tests should cover at least:

- deposit/lock isolation between two tables,
- normal two-player settlement,
- fold settlement,
- tied/split settlement,
- side-pot-compatible final stack vectors,
- zero-stack/busted player result,
- replayed `hand_id`,
- stale version,
- wrong table,
- malformed participant vectors,
- conservation violation,
- excessive rake,
- unauthorized release,
- repeated settlement invocation,
- large integer values,
- event/audit data.

Property/invariant-style tests should be used where practical for conservation and replay resistance.

---

## 9. Explicit non-goals for Phase 2

Do not implement or pull forward:

- production wallet UI,
- Albedo integration,
- production CHIP issuance,
- production database,
- WebSocket game server,
- MPC dealer,
- ZK/fairness proof production integration,
- polished frontend.

A deterministic/test fairness digest may be used in Phase 2 only as a placeholder for the later MPC binding.

---

## 10. Recommended implementation order

Use small PRs:

```text
2A. Freeze settlement types + contract workspace
2B. TableVault state/custody core
2C. Settlement replay/version/conservation core
2D. Treasury/Rake boundary
2E. Cashier boundary with test asset
2F. Cross-contract integration tests
2G. Testnet deployment only after local review
```

Each PR must include focused tests and must re-check the current Stellar toolchain/protocol before adding version-specific assumptions.
