# Flopiq Soroban Workspace

Status: **Phase 2 foundation — no financial contract logic implemented yet**

This directory is the isolated Rust workspace for Flopiq's Soroban layer. It is intentionally separate from the existing Node/pnpm workspace.

The production responsibilities are defined in:

- `../docs/SOROBAN_ARCHITECTURE.md`
- `../docs/SETTLEMENT_PROTOCOL.md`
- `../docs/ARCHITECTURE.md`
- `../docs/IMPLEMENTATION_PLAN.md`

## Planned contract boundaries

```text
contracts/
  Cargo.toml
  table-vault/
  settlement/
  treasury-rake/
  cashier/
```

Do not create all crates merely to make the tree look complete. Add each crate when its bounded implementation task begins.

## Development rules

- Use the current supported Stellar CLI/Soroban SDK when the first contract crate is created.
- Keep contract tests local before any network deployment.
- Never put wallet secret keys or deployment secrets in this repository.
- Do not hard-code a normal backend as the final settlement authority.
- Do not mix Poker Core CHIP units with Stellar asset base units without an explicit conversion boundary.
- Do not connect experimental authorization/fairness logic to real-value funds.

Once contract crates exist, the workspace should support commands such as:

```bash
cargo test --manifest-path contracts/Cargo.toml
stellar contract build
```

The exact build invocation may be refined when the first crate is generated with the then-current Stellar toolchain.
