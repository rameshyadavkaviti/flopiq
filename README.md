# Flopiq

Flopiq is a Stellar-based No-Limit Texas Hold'em cash-game platform. The current implementation phase is the standalone deterministic Poker Core; frontend, networking, persistence, wallets, blockchain integration, dealing, and settlement are not implemented yet.

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

Architecture and implementation constraints are documented in [`docs/`](docs/).
