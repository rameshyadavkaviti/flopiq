# Soroban State Foundation Implementation Plan

> Use superpowers:executing-plans for this isolated implementation and independent review.

**Goal:** Implement the approved Phase 2A types and replay/version boundary locally.
**Architecture:** One non-custodial state contract, reusable types, no token APIs.
Unanimous participant authorization is temporary; amounts are test units only.
**Tech stack:** Rust 1.99.0, Soroban SDK 28.0.0, Stellar CLI 28.1.0.
**Spec:** `docs/SOROBAN_ARCHITECTURE.md`, `docs/SETTLEMENT_PROTOCOL.md`.

## Constraints and review focus

- Poker Core unchanged; no production token or fairness claims.
- Seat-canonical participants and exact vector equality with committed state.
- Auth binds all input; failures cannot consume a hand or mutate state.
- Persistent replay markers survive archival; no temporary replay storage.
- Zero rake until policy/routing exists; checked nonnegative i128 test amounts.
- Caller-selected IDs are local fixtures; registration is a prerequisite to custody.

## Bounded task

- [x] Inspect live main/PRs/CI and approved documents; verify official APIs/tooling.
- [x] Add `contracts/table-state/src/tests.rs` with transition/replay tests; observe missing API failure.
- [x] Implement `types.rs`, `validation.rs`, and `lib.rs`: initialize/state/commit.
- [x] Add malformed vectors, auth, conservation, table isolation, overflow, event,
  XDR, storage, and generated sequence checks.
- [x] Pin Rust/SDK and lockfile; add Rust CI and document development limitations.
- [x] Run fmt, clippy, all Rust tests, Wasm build, and existing JS verification.
- [ ] Independent review, inspect diff, commit/push, open small PR, check CI/reviews.
- [ ] Merge only when clean; report deferred custody/authorization design boundary.
