# Flopiq Canonical Settlement Protocol

Status: **Phase 2 protocol baseline**
Version: **draft v1**

This document defines the canonical completed-hand data that bridges Poker Core results to the Soroban settlement layer.

It is a protocol boundary, not an implementation of the final Phase 6 authorization/proof scheme.

---

## 1. Purpose

A completed poker hand produces deterministic facts.

Soroban must consume a narrowly defined representation of those facts rather than trusting free-form backend instructions.

Conceptually:

```text
Poker Core completed hand
        │
        ▼
canonical settlement payload
        │
        ▼
authorization / fairness binding
        │
        ▼
Soroban Settlement
        │
        ▼
TableVault + Treasury state transition
```

---

## 2. Logical payload

The initial logical payload must contain at least:

```text
protocol_version
table_id
hand_id

previous_state_version
next_state_version

participants[]
starting_stacks[]
final_stacks[]

rake

action_transcript_digest
fairness_digest
```

The concrete Soroban types and serialization are finalized in the first contract/types PR.

Expected direction:

- version: unsigned integer,
- table/hand identifiers: fixed/canonical identifiers,
- participants: canonical ordered Stellar addresses,
- stack/rake values: nonnegative integer amounts in one explicitly defined amount domain,
- digests: fixed 32-byte values.

Do not use floating point.

---

## 3. Canonical participant order

`participants`, `starting_stacks`, and `final_stacks` are parallel vectors.

Their order must be canonical and deterministic.

The first implementation should use one documented ordering derived from table/seat identity and must reject duplicate participants.

The order must not depend on hash-map iteration, database row order, request arrival order, or UI order.

---

## 4. Required invariants

For a normal completed hand with no between-hand deposit/withdrawal inside the settlement transition:

```text
sum(starting_stacks)
=
sum(final_stacks) + rake
```

Also require:

- every starting stack is nonnegative,
- every final stack is nonnegative,
- `rake >= 0`,
- participant vector is non-empty and valid for the table,
- vector lengths match,
- participants are unique,
- `next_state_version = previous_state_version + 1` unless a later protocol version explicitly defines another rule,
- `hand_id` has never settled before,
- `previous_state_version` equals the TableVault's committed version,
- the declared starting balances match the committed pre-hand table state,
- final balances plus rake conserve the declared starting value.

No contract path may create CHIP through rounding or malformed vectors.

---

## 5. Replay protection

Replay protection is two-layered:

### Hand replay

The settlement layer records or otherwise proves consumption of `hand_id`.

A consumed `hand_id` cannot settle again.

### State replay

The table has a committed monotonic state/version.

A settlement must reference the exact previous version.

Once version `N → N+1` succeeds, another payload referencing version `N` fails even if it uses a different `hand_id`.

Both checks are required.

---

## 6. Transcript digest

`action_transcript_digest` binds the financial result to the canonical off-chain hand history.

The final digest algorithm/serialization must be specified before production integration.

Requirements:

- deterministic canonical serialization,
- ordered actions,
- table/hand identity included in the transcript domain,
- no dependence on JSON key order or runtime-specific serialization behavior,
- digest field represented as a fixed-length value on-chain.

Phase 2 may use deterministic test fixtures while the cross-language canonical encoder is developed.

---

## 7. Fairness digest

`fairness_digest` reserves the binding to the dealing/fairness process.

During Phase 2:

- it may contain a deterministic test fixture or explicit placeholder value,
- tests must treat it as an opaque fixed-size field,
- it must not be described as proof of fair dealing.

During Phase 6 it will bind to the approved MPC/session/proof evidence.

The settlement payload shape should not require redesign when the placeholder becomes real evidence.

---

## 8. Authorization digest

When settlement authorization is signed/proved, the authorization preimage must domain-separate the payload.

At minimum bind:

```text
network/domain
settlement_contract_id
protocol_version
table_id
hand_id
previous_state_version
next_state_version
participants
starting_stacks
final_stacks
rake
action_transcript_digest
fairness_digest
```

No field that affects financial meaning may be omitted from authorization.

The exact cryptographic authorization scheme is intentionally not frozen in Phase 2.

---

## 9. Rake

Rake is explicit in the payload.

Rules:

- integer-only,
- nonnegative,
- bounded by the table's configured/versioned rake policy,
- zero when policy says no rake applies,
- routed to the Treasury/Rake boundary,
- included in conservation checks.

For a hand:

```text
starting total = ending player total + rake
```

There is no hidden fee field.

---

## 10. Uncalled CHIP and pot construction

Soroban does not reconstruct betting, side pots, hand rankings, or uncalled refunds.

Poker Core remains authoritative for those deterministic poker rules.

By the time settlement is produced:

- uncalled amounts are already reflected in final stacks,
- split pots and odd CHIP are already resolved,
- folded-player eligibility is already resolved,
- side pots are already resolved.

Soroban validates the financial transition and authorization; it does not become a second poker engine.

---

## 11. Between-hand deposits, releases, and rebuys

Do not mix hand settlement with unrelated cashier/vault operations.

A hand settlement transitions only the committed table state for that hand.

Between-hand operations use separate authorized transitions and explicit state/version rules.

This keeps replay and accounting reasoning narrow.

---

## 12. Cross-language requirement

The TypeScript side and Rust/Soroban side must eventually share test vectors for:

- canonical payload serialization,
- digest computation,
- participant ordering,
- amount encoding,
- version fields.

Before production integration, one fixture must produce byte-for-byte identical canonical data/digests in both languages.

---

## 13. Phase 2 completion condition

The settlement protocol is ready for the next phase when local contract tests demonstrate:

- table balance isolation,
- valid settlement transition,
- replay rejection,
- stale-version rejection,
- conservation enforcement,
- rake enforcement,
- safe release rules,
- deterministic event/audit output,
- cross-contract integration with TableVault and Treasury/Rake.

Production MPC authorization is explicitly not required for Phase 2 completion.
