# Flopiq Soroban workspace

Phase 2A implements a **non-custodial, local-test state foundation**. Phase 2 is
not complete. No contract in this workspace accepts, holds, or transfers tokens.
Do not deploy this foundation with real funds.

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

Amounts are **Phase 2A test accounting units**, capped at nonnegative `i128`
with checked totals. They are neither Poker Core CHIP nor SAC base units. No
conversion exists; production asset conversion is explicitly deferred to Phase 3.
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

## Limitations and next boundary

Initialization creates test balances, not collateralized claims. Table/hand IDs
are trusted fixture inputs: without an allocation/registration scheme, an untrusted
caller could preemptively consume another caller's intended identifier using their
own consenting participants. This is another reason this contract is local-only.
Hand uniqueness is enforced within this contract instance, not across deployments.
There is no pending-hand registration, membership change, rebuy, withdrawal, token
integration, custody, upgrade/admin path, treasury, or cashier.

Before custody, define authenticated table/hand allocation and collateral-backed
initialization; do not turn this test initializer into a production deposit API.
Keep TableVault, Settlement, Treasury/Rake, and Cashier as explicit responsibilities.
The next safe task is a reviewed TableVault deposit/lock design with a test SAC,
player-owned authorization, explicit amount domain and table registration, followed
by its own small tested implementation. Final fairness authorization is still Phase 6.

Architecture: [Soroban](../docs/SOROBAN_ARCHITECTURE.md),
[settlement protocol](../docs/SETTLEMENT_PROTOCOL.md),
[implementation plan](../docs/IMPLEMENTATION_PLAN.md).
