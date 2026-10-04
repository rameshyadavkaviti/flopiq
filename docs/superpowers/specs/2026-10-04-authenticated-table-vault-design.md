# Authenticated TableVault foundation design

## Scope

Add one bounded Soroban custody slice without moving poker rules on chain:
authenticated table allocation, exact test-SAC deposits, version-bound hand start,
and conserved settlement. Withdrawals and production authorization are excluded.

## State and identity

One vault instance binds an immutable SAC. Persistent storage contains aggregate
liabilities, current table state, and consumed-hand markers. Table identity hashes
the domain, network, vault, token, and canonical proposal. Hand identity hashes a
separate domain, network, vault, table, and committed version.

Tables move `Funding -> Ready -> Active(hand) -> Ready`. Each allocation contains
2–9 strictly seat-ordered unique participants and an exact positive buy-in for each.
Funding accepts each allocation once. A hand can only settle its active identity
and advance by exactly one version.

## Security boundary

All participants authorize allocation, hand start, and settlement. Each depositor
authorizes its deposit and nested SAC transfer. This prevents a normal backend key
from unilaterally reallocating funds, but unanimity is temporary and can deadlock.
The final evidence/threshold mechanism remains Phase 6.

The vault checks selected-token collateral against total liabilities before and
after financial transitions. Unsolicited selected-token transfers are surplus,
never credit. Issuer clawback creates a detectable deficit. No API can withdraw,
redirect rake, change the token, or mutate membership.

## Amount domains

Vault values are test SAC base units (`i128`). Settlement types use checked integer
arithmetic. Poker Core CHIP remains a separate `bigint` domain, and no conversion is
implied or implemented.
