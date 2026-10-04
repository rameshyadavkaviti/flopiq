# Flopiq Soroban workspace

Phase 2 now includes the non-custodial settlement-state foundation and an
**authenticated, SAC-backed local-test TableVault**. Phase 2 is not complete.
The vault includes only a bounded, player-authorized full exit from a ready table,
not a production leave-table lifecycle or production settlement authority. Do not
deploy it with real funds.

## Tooling

Verified against official Stellar documentation and SDK source on 2026-10-03:

- Soroban SDK **28.0.0**, pinned exactly; its Rust minimum is 1.91.
- Rust **1.99.0**, current stable, pinned in `rust-toolchain.toml`.
- Target **wasm32v1-none**; Stellar CLI **28.1.0** for local builds.
- Cargo lockfile committed; Node/pnpm workspace remains independent.

Sources: [setup](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup),
[workspace guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/hello-world),
[SDK manifest](https://github.com/stellar/rs-soroban-sdk/blob/v28.0.0/Cargo.toml),
[authorization](https://github.com/stellar/rs-soroban-sdk/blob/v28.0.0/soroban-sdk/src/address.rs),
[storage](https://github.com/stellar/rs-soroban-sdk/blob/v28.0.0/soroban-sdk/src/storage.rs),
[token API](https://github.com/stellar/rs-soroban-sdk/blob/v28.0.0/soroban-sdk/src/token.rs).
This is a protocol-28 local build selection, not a claim about deployment compatibility
with any network. Network versions must be rechecked before a later deployment.

Run from this directory so Rust applies the pinned toolchain:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
stellar contract build --locked
```

SDK 28 requires the CLI build path for contract-spec processing; a direct
`cargo build` is not the supported Wasm build command. CI verifies the pinned
CLI archive SHA-256 before executing it.

## Implemented boundary

`settlement-types` owns the canonical settlement payload, committed-state types,
and shared validation used by both contracts. This prevents the custody contract
and state-only foundation from drifting into different financial protocols.

`table-state` exports reusable Soroban types and a small contract:

- `initialize(table_id, participants, stacks)`: create version zero once.
- `state(table_id)`: read committed state.
- `commit(settlement)`: validate, require every participant's authorization,
  atomically commit next stacks/version and mark the hand consumed.

`Settlement` concretizes draft protocol v1 with `u32` protocol, 32-byte table/hand
IDs and digests, `u64` versions, seat/address participants, parallel `Vec<i128>`
stack vectors, and `i128` rake. Participants have unique addresses and strictly
increasing seats in 0..=8 (2–9 participants). Input is rejected, never sorted.
Soroban `contracttype` values use canonical ScVal XDR, not JSON or Rust memory
layout. The event commits SHA-256 of the full settlement XDR. This audit hash is
not a standalone signing protocol or fairness proof.

Amounts in `table-state` are **Phase 2A test accounting units**. Amounts in
`table-vault` are explicitly **test SAC base units**. Both are nonnegative `i128`
with checked totals. Neither is Poker Core CHIP, and no implicit 1:1 conversion
exists; production asset conversion remains deferred to Phase 3.
Rake must be exactly zero until a bounded policy and treasury routing exist.

Both entry points require unanimous participant `Address::require_auth()`, which
binds the full invocation arguments, contract, and function through Soroban host
authorization. Stellar authorization supplies network separation and nonce/expiry
handling. No backend/admin key or bypass exists. This is deliberately a development
consent mechanism; it does not establish poker correctness, prove dealing fairness,
or solve participant refusal/liveness. Phase 6 authorization remains separate.
`fairness_digest` and `action_transcript_digest` are opaque supplied commitments.

Persistent storage contains one current state per table and one boolean per
consumed hand across this contract. Historical stacks/transcripts are not duplicated.
Replay markers are never deleted or temporary. Archived persistent entries must be
restored, not treated as absent; automatic/manual restoration and TTL maintenance
are operational requirements before deployment. This slice has no TTL service.

`table-vault` adds authenticated table allocation, exact one-time deposits into
one immutable SAC, version-bound hand allocation, conserved settlement, and exact
full-balance exits from `Ready`. See [table-vault/README.md](table-vault/README.md)
for its API and threat boundary.

## Limitations and next boundary

The original `table-state` contract remains a local state-only test foundation.
The vault has no partial withdrawal, redeposit, re-entry, participant replacement,
seat reassignment, table closure, timeout, admin, upgrade, treasury, or cashier
path. A full exit retains the participant with zero liability and prevents another
hand from starting. Its unanimous participant consent model is safe for local
development but has a deliberate liveness limitation: any player can refuse to
start or settle a hand. Final fairness/threshold authorization is still Phase 6.
Issuer clawback can make a vault insolvent; the vault detects that condition and
blocks financial transitions, but cannot repair it.

Architecture: [Soroban](../docs/SOROBAN_ARCHITECTURE.md),
[settlement protocol](../docs/SETTLEMENT_PROTOCOL.md),
[implementation plan](../docs/IMPLEMENTATION_PLAN.md).
