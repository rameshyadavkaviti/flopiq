# TableVault foundation

This contract is the smallest SAC-backed custody foundation for Phase 2. It is
designed for local contract tests, not deployment with real player funds.

## API

- `create_table(proposal)` derives a domain-separated table ID and requires all
  canonical participants to authorize the complete allocation.
- `deposit(table_id, player, amount)` accepts exactly that player's one-time
  allocation and transfers the configured SAC into the vault under player auth.
- `exit(table_id, player, version)` returns that player's entire balance while
  the table is `Ready`, reduces liability by the exact same amount, and advances
  the committed version once under that player's authorization.
- `start_hand(table_id, version)` requires unanimous consent and derives a
  domain-separated hand ID from the table and committed version.
- `commit(settlement)` requires the active hand, shared settlement validation,
  collateral solvency, and unanimous consent before atomically advancing state.
- `table`, `token`, and `backing` expose deterministic read-only state.

The configured token must be a Stellar Asset Contract and cannot be changed.
Table and hand identities bind their domain tag, network ID, vault address,
token/table context, and allocation/version material through canonical ScVal XDR.

## Accounting

Vault amounts are test SAC base units represented as `i128`. They are not Poker
Core CHIP. There is no conversion rule in this contract.

The contract maintains aggregate player liabilities and verifies:

```text
selected-SAC collateral >= aggregate table liabilities
surplus = collateral - liabilities
```

Deposits increase both a player's committed stack and aggregate liability by the
same exact amount. Conserved zero-rake settlements change stack ownership but not
liabilities. A full exit decreases the player's stack, aggregate liability, and
selected-SAC collateral by the same exact amount. Direct selected-token transfers
become explicit surplus and never player credit. Other tokens are ignored. A
clawback-induced deficit blocks hand start, settlement, and further deposits.

## Authorization and storage

Allocation, hand start, and settlement use unanimous participant `require_auth`.
Deposit authorization is player-specific and its authorization tree includes the
nested SAC transfer. Exit authorization is also player-specific; no backend or
administrator can release another participant's balance. Failed invocations roll
back contract storage and token moves.

Tables, aggregate liabilities, and consumed-hand markers use persistent storage.
The configured token uses instance storage. Archived entries must be restored and
their rent maintained operationally; SDK tests cover automatic restoration without
allowing replay or loss of table ownership.

## Deliberate omissions

Exit is deliberately only a full financial exit from `Ready`, not a complete
leave-table lifecycle. The participant and seat remain allocated with a zero
stack, the table remains `Ready`, and another hand cannot start while any retained
participant has zero liability. Sequential and final exits are supported. There
is no redeposit, re-entry, participant removal, seat reassignment, table closure,
cashier, rake, treasury, token conversion, upgrade, administrator, timeout, MPC,
or production fairness proof. The two settlement digests remain opaque
commitments. Unanimous consent prevents unilateral backend movement but permits
participant refusal, which is a known development-liveness tradeoff rather than
the final Phase 6 authorization design.
