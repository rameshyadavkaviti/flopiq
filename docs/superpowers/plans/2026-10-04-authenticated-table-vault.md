# Authenticated TableVault implementation plan

1. Extract Phase 2A settlement types and validation into a shared no-std crate.
2. Add a TableVault contract bound to one verified SAC.
3. Add authenticated canonical table/hand allocation and persistent replay state.
4. Add exact one-time deposits with collateral/liability checks.
5. Reuse settlement validation for zero-rake versioned state transitions.
6. Test real SAC movement, authorization, replay, isolation, conservation,
   malformed state, large values, rollback, issuer deficit, and restoration.
7. Run pinned Rust format/clippy/tests/WASM build plus repository checks.
8. Publish one reviewable PR; merge only after clean CI and review.
