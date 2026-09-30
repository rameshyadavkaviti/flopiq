# Flopiq Architecture v1

Status: **Approved architecture baseline**
Scope: **Texas Hold'em No-Limit cash games on Stellar**
Purpose: This document is the source of truth for the first production architecture of Flopiq.

---

## 1. Product Goal

Flopiq is a Stellar-based online poker platform focused first on:

1. correct poker logic,
2. player-fund security,
3. fair and verifiable dealing,
4. privacy of unrevealed cards,
5. clear wallet-based ownership,
6. strong failure isolation,
7. a fast real-time game experience.

The first supported game is **No-Limit Texas Hold'em cash games**.

The platform should be visually and technically stronger than existing Stellar poker projects, especially in security, player control, verification, and user experience.

---

## 2. Core Security Requirement

The most important architecture rule is:

> Compromising one Flopiq-controlled backend must not be sufficient to steal player funds, secretly manipulate the deck, learn all private hole cards, or fabricate a valid settlement.

This requirement must be considered before convenience, implementation speed, or infrastructure simplicity.

The game server coordinates play, but it must not be the final authority over player money or deck fairness.

---

## 3. High-Level Architecture

```text
                        FLOPIQ

                 +------------------+
                 |   Next.js Client |
                 | Tailwind UI      |
                 +--------+---------+
                          |
                          | HTTPS / WebSocket
                          v
                 +------------------+
                 | Auth / Session   |
                 | Stellar wallet   |
                 | identity         |
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Realtime Poker   |
                 | Gateway / Server |
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Deterministic    |
                 | Poker Core       |
                 +---+----------+---+
                     |          |
                     |          +--------------------+
                     |                               |
                     v                               v
            +----------------+              +----------------+
            | MPC Dealer     |              | Hand History   |
            | Network        |              | / Audit Store  |
            | N1 / N2 / N3   |              +----------------+
            +-------+--------+
                    |
                    v
            +----------------+
            | Settlement     |
            | Coordinator    |
            +-------+--------+
                    |
                    v
      +-----------------------------------+
      |              SOROBAN              |
      |                                   |
      | Cashier                           |
      | TableVault                        |
      | Settlement                        |
      | Treasury / Rake                   |
      +----------------+------------------+
                       |
                       v
                +-------------+
                | CHIP SAC    |
                | Stellar     |
                +-------------+
```

---

## 4. Technology Baseline

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- Stellar wallet integration
- Albedo as the first supported wallet
- WebSocket-based real-time table updates

### Backend

- Node.js
- TypeScript
- server-authoritative game coordination
- deterministic poker engine
- PostgreSQL for durable application state
- Redis or equivalent only for ephemeral coordination if needed

### Blockchain

- Stellar mainnet when production-ready
- Soroban smart contracts
- CHIP represented as a Stellar asset with a Stellar Asset Contract unless later investigation reveals a concrete reason to use a custom token implementation

### Fairness

- 3-node MPC / threshold dealing architecture
- protocol designed to tolerate one malicious node
- no single node should be able to reconstruct or control the deck alone

---

## 5. Player Identity

A player's **Stellar wallet address is the permanent account identity**.

The application must not require a traditional username/password identity for ownership.

Initial authentication flow:

```text
Client requests challenge
        |
        v
Server creates one-time challenge
        |
        v
Player signs using Albedo
        |
        v
Server verifies Stellar signature
        |
        v
Short-lived authenticated session
```

Requirements:

- never ask for or store player secret keys,
- challenges must be single-use,
- challenges must expire,
- domain separation must prevent a poker login signature being reused as another authorization,
- sessions must be revocable,
- financial authorization must not depend only on an application session.

---

## 6. CHIP

### Exchange Rate

The first version uses a fixed cashier rate:

```text
1 XLM = 100 CHIP
100 CHIP = 1 XLM
```

This is a cashier conversion rate, not an open market pricing mechanism.

### Recommended Token Model

Use:

```text
Stellar Asset
      |
      v
Stellar Asset Contract (SAC)
      |
      +--> Player wallets
      |
      +--> Flopiq Soroban contracts
```

Poker-specific rules should live in Flopiq contracts rather than inside a custom CHIP token contract unless future requirements justify otherwise.

### Accounting Rule

All CHIP math must be integer-only.

No floating-point representation is allowed for balances, bets, pots, fees, rake, or settlement.

---

## 7. Cashier

The Cashier is responsible for XLM <-> CHIP conversion.

Responsibilities:

- accept XLM purchase requests,
- issue or transfer corresponding CHIP,
- accept CHIP redemption requests,
- return corresponding XLM,
- enforce the fixed 100:1 rate,
- emit auditable events,
- prevent replay,
- use explicit integer rounding rules,
- enforce treasury solvency.

The cashier must never use the poker backend's database balance as the source of truth for withdrawable funds.

---

## 8. Table Funds and TableVault

When a player joins a table, the selected buy-in is locked for that table.

Example:

```text
Wallet GABC...

Available wallet CHIP: 7,000

Table A:
    locked: 1,000 CHIP

Table B:
    locked: 2,000 CHIP

Table C:
    locked: 500 CHIP
```

Funds must be isolated by at least:

```text
(wallet_address, table_id)
```

A failure or dispute in Table A must not corrupt the player's Table B or Table C position.

### Join Table

```text
Player wallet
      |
      | authorize CHIP transfer
      v
TableVault
      |
      +--> table_id
      +--> player
      +--> locked amount
```

### Leave Table

A player cannot withdraw committed table funds in the middle of an active hand.

Leaving during a hand means:

```text
request leave
    |
finish current hand
    |
final settlement
    |
unlock remaining table stack
    |
return CHIP to player
```

---

## 9. Contract Separation

Do not implement Flopiq as one giant Soroban contract.

Initial responsibilities should be separated into small contracts or clearly isolated contract modules.

### 9.1 Cashier

Responsibilities:

- XLM -> CHIP
- CHIP -> XLM
- fixed exchange rate
- liquidity / treasury checks

### 9.2 TableVault

Responsibilities:

- lock buy-ins,
- isolate balances by table,
- release funds after safe table exit,
- prevent mid-hand withdrawal,
- enforce authorized movements.

### 9.3 Settlement

Responsibilities:

- accept settlement records only through the approved authorization path,
- bind settlement to a unique hand,
- reject replay,
- validate conservation of funds,
- update table-level balances,
- route rake,
- emit audit events.

### 9.4 Treasury / Rake

Responsibilities:

- receive approved rake,
- separate platform funds from player funds,
- support transparent accounting.

The final deployment may combine modules where justified by Soroban operational constraints, but security boundaries must remain explicit.

---

## 10. What Runs On-Chain vs Off-Chain

### Off-chain

These should remain off-chain for performance:

- check,
- call,
- bet,
- raise,
- fold,
- timers,
- turn rotation,
- intermediate stack calculations,
- street progression,
- side-pot construction,
- normal table broadcasts.

### On-chain

Soroban should control the financial state that ultimately matters:

- CHIP locking,
- CHIP release,
- authorized settlement,
- rake transfers,
- cashier conversions,
- replay-resistant financial state transitions.

### Rule

The Soroban layer must not blindly accept:

> "The backend says player X won Y CHIP."

Settlement authorization must be cryptographically bound to the actual hand/session and the approved fairness/settlement process.

The exact threshold-signature or proof scheme is an implementation-design task and must be security-reviewed before mainnet.

---

## 11. Deterministic Poker Core

The Poker Core must be a pure or near-pure deterministic state machine.

It must not depend on:

- UI state,
- database timing,
- WebSocket order outside the defined sequence,
- floating point,
- random server-side business logic.

Input:

```text
previous game state
+
validated player action
```

Output:

```text
new game state
+
deterministic events
```

The same valid action sequence must always produce the same result.

### Core responsibilities

- seating,
- button movement,
- small blind,
- big blind,
- optional straddle,
- action order,
- checking,
- calling,
- betting,
- raising,
- minimum raise rules,
- all-in handling,
- short all-in reopening rules,
- folding,
- pot construction,
- multiple side pots,
- street progression,
- showdown eligibility,
- winner calculation,
- CHIP conservation.

---

## 12. Supported Poker Rules

Version 1:

- No-Limit Texas Hold'em
- cash games only
- 2 to 9 seats supported by the engine
- small blind / big blind
- optional table-level straddle
- no ante initially
- 20-100 BB standard buy-in
- no "run it twice"
- standard heads-up rules
- standard main and side pot rules
- multiple simultaneous side pots supported

### Heads-Up

When two players remain:

- dealer/button posts small blind,
- other player posts big blind,
- dealer acts first preflop,
- big blind acts first postflop.

---

## 13. Betting

Players choose their bet or raise amount.

Players do **not** choose the pot amount.

The pot is always derived by the deterministic engine.

Example:

```text
SB = 5
BB = 10

Player A calls 10
Player B raises to 37
Player C calls 37

Pot is calculated by Poker Core.
```

All validations happen server-side in Poker Core even if the client also performs convenience validation.

---

## 14. Timer and Disconnect Policy

Standard action timer:

```text
15 seconds + time bank
```

Disconnect behavior must not be chosen by the server after the disconnect occurs.

The player preselects a policy.

Initial supported policies should include at least:

1. use time bank, then check if legal, otherwise fold,
2. immediate check if legal, otherwise fold.

The policy may be configurable globally and overridden per table.

A disconnect never authorizes arbitrary betting by the server.

---

## 15. Sit Out

A player may select:

```text
Sit out next hand
```

The current hand continues normally.

The player is then excluded from the next deal.

Their table CHIP remains locked until they explicitly leave the table.

Seat-release policy can be defined later operationally.

---

## 16. Rebuy and Auto-Rebuy

Manual rebuy is allowed.

Auto-rebuy is allowed.

New CHIP must never change the effective stack of an already-running hand.

Flow:

```text
rebuy requested
      |
      v
funds locked
      |
      v
pending table credit
      |
hand finishes
      |
      v
new stack becomes active
```

Auto-rebuy policy should support configurable targets later, such as restoring to a selected BB level.

---

## 17. Rake

Rake model:

- percentage of eligible pot,
- maximum cap,
- very small platform fee,
- exact percentage and caps to be selected after simulation.

Initial policy:

> No flop, no drop.

If a hand ends before a flop is dealt, rake is zero.

Rake math must be deterministic and integer-only.

Rake must never create or destroy CHIP accidentally.

For every hand:

```text
sum(starting stacks)
=
sum(ending stacks)
+
rake
```

subject only to explicitly modeled between-hand deposits/withdrawals.

---

## 18. MPC Dealer Architecture

Flopiq must use MPC / threshold dealing rather than trusting a single dealer server.

Initial target:

```text
Dealer Node 1
Dealer Node 2
Dealer Node 3
```

Security target:

> One malicious node must not be sufficient to learn or manipulate the complete deck.

Node operators can be decided later.

The protocol must be designed so that independent operation is possible.

### Required properties

The final protocol must provide:

- unpredictable shuffle,
- no unilateral deck control,
- no unilateral private-card recovery,
- verifiable session binding,
- resistance to replay,
- deterministic association with `hand_id`,
- evidence sufficient for later verification,
- safe abort behavior.

### Important restriction

Do not implement a homemade cryptographic MPC protocol without review.

The implementation phase should select a well-studied construction or audited library/protocol where possible.

---

## 19. Card Privacy

By default, no player's cards are shown unnecessarily.

### Folded hands

Folded cards remain private.

A voluntarily shown hand may be revealed when the rules permit it.

### Showdown

Standard showdown rules apply.

If disclosure is required to determine/claim the pot, the required hand is exposed.

If disclosure is not required, the player retains SHOW/MUCK choice.

### All-In

When all remaining players are all-in and no further betting decision exists, remaining hands may be exposed and the board may complete normally.

No stronger privacy semantics are required for v1.

---

## 20. SHOW / MUCK

The user must retain meaningful control over card disclosure after a hand.

Default behavior:

```text
MUCK
```

unless normal poker rules require disclosure.

The UI should present SHOW/MUCK clearly where applicable.

A mucked opponent's cards must never become visible later merely because the hand appears in hand history.

---

## 21. Hand Identity

Every hand must have a globally unique `hand_id`.

The `hand_id` must bind:

- table ID,
- game sequence,
- MPC session,
- betting action log,
- settlement record,
- audit data.

Conceptually:

```text
table
  |
hand_id
  |
  +--> MPC session
  +--> action transcript
  +--> board
  +--> pots
  +--> showdown
  +--> settlement
  +--> contract transaction
```

A settlement for one hand must never be reusable for another.

---

## 22. Settlement Lifecycle

Conceptual lifecycle:

```text
HAND START
    |
    v
MPC session established
    |
    v
cards dealt
    |
    v
deterministic actions
    |
    v
hand resolved
    |
    v
Poker Core calculates:
    - winners
    - pots
    - side pots
    - rake
    - resulting stacks
    |
    v
settlement payload created
    |
    v
required threshold / proof authorization
    |
    v
Soroban Settlement validates:
    - hand identity
    - authorization
    - replay protection
    - CHIP conservation
    - table participants
    - allowed rake
    |
    v
table balances committed
    |
    v
settlement event emitted
```

---

## 23. Multi-Table Play

One Stellar wallet may play at multiple tables simultaneously.

Each table position must be financially independent.

Example:

```text
Player wallet

Table A -> 1,000 CHIP
Table B -> 2,000 CHIP
Table C ->   500 CHIP
```

Requirements:

- funds cannot be double-counted,
- one CHIP balance cannot back two table stacks,
- a blocked hand at one table must not freeze unrelated tables,
- each table has its own sequence and hand state.

---

## 24. Hand History

Players should be able to inspect at least their latest **20 hands**.

Player-visible hand history should include:

- hand ID,
- table,
- timestamp,
- starting stack,
- blind positions,
- own hole cards,
- public board,
- player actions,
- pot changes,
- main/side pots,
- rake,
- showdown information legally visible to that player,
- SHOW/MUCK decisions,
- resulting stack,
- settlement status.

### Privacy Rule

Never reveal mucked private cards in hand history.

### Audit History

A technical verification view may additionally expose:

- MPC session identifier,
- public commitments,
- verification status,
- settlement digest,
- contract transaction,
- relevant contract addresses,
- public audit events.

---

## 25. Verification UX

Normal users should not need to understand cryptography.

Default table/hand UI should present something like:

```text
Hand #...
Pot: 428 CHIP
Fee: 0.4 CHIP

Deal verified
Result verified
Settlement verified
```

Technical users may open:

```text
View verification details
```

and inspect the public evidence.

Verification should be understandable without making blockchain terminology dominate the poker experience.

---

## 26. Spectators

Spectator mode is desirable but not required for the first critical MVP.

When implemented:

- spectator data must never leak hole cards,
- latency/delay policy should be configurable,
- spectators must not become part of the trusted game path.

---

## 27. Social Features

Not part of the security-critical MVP:

- table chat,
- friends,
- reactions,
- avatars,
- advanced profiles.

These must not delay the game/security foundation.

---

## 28. Data Model

This is a conceptual database model, not final SQL.

### players

```text
wallet_address PK
created_at
last_seen_at
disconnect_policy
```

### tables

```text
table_id PK
status
max_seats
small_blind
big_blind
straddle_enabled
min_buyin_bb
max_buyin_bb
rake_policy_id
created_at
```

### table_players

```text
table_id
wallet_address
seat
status
logical_stack
vault_balance_reference
sit_out_next_hand
leave_after_hand
auto_rebuy_config
```

### hands

```text
hand_id PK
table_id
sequence
button_seat
state
started_at
completed_at
mpc_session_id
settlement_digest
settlement_tx
```

### hand_actions

```text
hand_id
sequence
wallet_address
action
amount
street
timestamp
```

### hand_results

```text
hand_id
wallet_address
starting_stack
ending_stack
contribution
payout
rake_share_if_needed
show_status
```

### mpc_sessions

```text
mpc_session_id PK
hand_id
protocol_version
node_set
public_verification_data
status
```

Application database records are not substitutes for Soroban financial truth.

---

## 29. Trust Boundaries

### Browser

Trusted for:

- displaying state,
- collecting intent,
- wallet interaction.

Not trusted for:

- legal move validation,
- stack values,
- pot values,
- timers,
- settlement.

### Realtime Poker Server

Trusted to:

- sequence validated actions,
- coordinate tables,
- enforce deterministic Poker Core transitions.

Not trusted to:

- possess wallet secret keys,
- unilaterally move locked CHIP,
- determine the deck alone,
- fabricate a valid financial settlement alone.

### Database

Trusted for availability and application history.

Not the final authority for:

- withdrawable CHIP,
- vault ownership,
- completed on-chain settlement.

### MPC Node

One node is explicitly considered potentially malicious.

No individual MPC node should control the deck or know all private card information.

### Soroban Contracts

Financial authority.

Contracts must enforce explicit invariants and authorization.

### Stellar Wallet

Player's ownership authority.

A wallet signature must never be treated as a general unlimited permission.

---

## 30. Failure Model

### Poker server crashes

Required behavior:

- no player funds disappear,
- no duplicate settlement,
- active hand can be recovered or safely aborted according to protocol,
- durable action log allows reconstruction.

### Client disconnects

Use player's preselected disconnect policy.

### One MPC node fails

Protocol should tolerate safe failure where practical.

If fairness cannot be guaranteed, the hand must abort safely rather than continue insecurely.

### One MPC node is malicious

Target architecture must preserve confidentiality/fairness against one malicious node.

### Database unavailable

Do not perform unsafe financial guesses from cache.

### Soroban transaction delayed/fails

Settlement remains pending and retryable/idempotent.

Never start contradictory settlement.

### Realtime server compromised

Attacker should not gain unilateral ability to:

- withdraw player vault funds,
- create CHIP,
- redeem treasury XLM,
- choose the deck,
- reveal all hole cards,
- sign a valid settlement alone.

---

## 31. Core Financial Invariants

These invariants are mandatory.

### Conservation

For each completed hand:

```text
total starting table CHIP
=
total ending table CHIP
+
rake
```

excluding explicit between-hand deposits or withdrawals.

### No negative balance

No player, table, vault, cashier, or treasury CHIP accounting may become negative.

### No double spend

The same locked CHIP cannot appear at two tables.

### No mid-hand withdrawal

Committed chips remain locked through hand completion.

### Idempotent settlement

Submitting the same valid settlement twice must not pay twice.

### Exact hand binding

Settlement authorization for Hand A must fail for Hand B.

### Rake bounds

The contract must reject rake greater than the table's configured policy permits.

---

## 32. Action and Event Logging

Security-relevant actions should use append-oriented logs.

Examples:

- join request,
- vault deposit confirmed,
- hand start,
- MPC session start,
- player action,
- timeout action,
- disconnect policy action,
- showdown,
- show/muck,
- result,
- settlement request,
- settlement confirmation,
- leave request,
- vault release.

Logs must use monotonic sequence numbers within their scope.

Do not rely only on wall-clock timestamps for ordering.

---

## 33. Versioning

Security-critical protocols must be versioned.

Examples:

```text
poker_rules_version
settlement_schema_version
mpc_protocol_version
contract_version
```

A historical hand must remain interpretable after upgrades.

---

## 34. Deployment Security

Production requirements should eventually include:

- separate production and development Stellar identities,
- no secrets committed to Git,
- least-privilege infrastructure credentials,
- protected deployment environments,
- reproducible contract builds,
- contract WASM hash verification,
- multisig / threshold administration where practical,
- contract upgrade policy,
- emergency pause only where necessary,
- explicit recovery procedures.

An emergency mechanism must not silently give an administrator the ability to seize player balances.

---

## 35. Testing Strategy

### Poker Core

Must have extensive deterministic unit/property testing for:

- legal/illegal actions,
- blinds,
- straddles,
- heads-up,
- minimum raises,
- short all-ins,
- reopened action,
- folds,
- main pots,
- multiple side pots,
- simultaneous all-ins,
- odd-chip rules,
- chip conservation.

### Contracts

Test:

- unauthorized deposits/releases,
- duplicate settlement,
- wrong hand ID,
- wrong table ID,
- excessive rake,
- malformed payout vectors,
- negative/overflow-equivalent conditions,
- reentrancy-equivalent assumptions where applicable,
- failed/partial operations,
- admin misuse paths.

### MPC

Test:

- one offline node,
- one malicious node,
- replay,
- message reordering,
- session confusion,
- duplicate messages,
- malformed shares,
- early abort,
- confidentiality assumptions.

### End-to-End

At minimum:

```text
wallet login
-> buy CHIP
-> join table
-> play hand
-> MPC dealing
-> all-in / side pot
-> SHOW/MUCK
-> settlement
-> hand history
-> leave
-> receive CHIP
-> redeem CHIP to XLM
```

---

## 36. Implementation Boundaries

The implementation should be organized so security-critical components can be tested independently.

Recommended repository direction:

```text
apps/
  web/
  game-server/

packages/
  poker-core/
  protocol/
  hand-history/
  stellar-client/

contracts/
  cashier/
  table-vault/
  settlement/
  treasury/

services/
  mpc-node/

docs/
  ARCHITECTURE.md
  protocol/
  threat-model/
```

Exact workspace structure can be adjusted during implementation, but Poker Core must remain independent from UI and blockchain clients.

---

## 37. Recommended Build Order

### Phase 1 - Deterministic Poker Core

Build and exhaustively test:

- table state,
- actions,
- betting,
- all-ins,
- side pots,
- showdown,
- 2-9 seats.

No blockchain dependency.

### Phase 2 - Protocol and Realtime Server

Build:

- table lifecycle,
- action sequencing,
- reconnect,
- timers,
- sit-out,
- manual rebuy,
- auto-rebuy,
- multi-table sessions.

### Phase 3 - Soroban Financial Layer

Build:

- CHIP integration,
- Cashier,
- TableVault,
- Settlement,
- Treasury/Rake,
- financial invariants.

### Phase 4 - MPC Dealer

Integrate the selected reviewed MPC/threshold dealing design.

MPC design must receive an explicit security review before production deployment.

### Phase 5 - End-to-End Security Integration

Bind:

```text
hand_id
+ MPC session
+ action transcript
+ settlement
+ Soroban state
```

### Phase 6 - Production UI

Build polished poker UX after the critical game and security model is stable.

---

## 38. Decisions Intentionally Deferred

These are not undefined requirements; they are intentionally deferred until the architecture below them is stable.

- exact rake percentage,
- rake caps by stake/player count,
- final MPC protocol/library,
- operators of MPC nodes,
- spectator release timing,
- advanced table stakes,
- ante support,
- social features,
- tournament support,
- additional wallet providers,
- regulatory/geographic controls,
- production treasury governance.

---

## 39. Non-Goals for v1

Do not add these to the security-critical MVP unless requirements change:

- tournaments,
- Omaha,
- run-it-twice,
- casino games,
- arbitrary on-chain betting actions,
- player-created arbitrary financial contracts,
- chat/social system,
- complex avatars/profiles,
- public exposure of mucked hole cards.

---

## 40. Architecture Acceptance Rule

Any future component or feature must answer five questions:

1. What data can it see?
2. What state can it change?
3. What authority does it hold?
4. What happens if it fails?
5. What happens if it becomes malicious?

If compromise of one ordinary backend component can steal player funds, control the deck, reveal all private cards, or fabricate settlement, the architecture has violated this document.

---

## 41. Frozen v1 Product Decisions

The following decisions are approved for the architecture baseline:

- No-Limit Texas Hold'em only for now.
- Cash games only.
- 2-9 player architecture.
- 20-100 BB initial buy-in.
- SB/BB only; no ante initially.
- Optional straddle in v1.
- Never run it twice.
- Full main/side-pot support.
- Standard heads-up behavior.
- 15 second action timer plus time bank.
- `Sit out next hand`.
- manual rebuy.
- auto-rebuy.
- percentage + cap rake.
- no-flop-no-drop.
- SHOW/MUCK where rules allow.
- normal all-in card exposure.
- wallet is the permanent player identity.
- minimum 20-hand player history.
- spectator mode desirable but nonessential initially.
- social functionality later.
- one wallet may play multiple tables.
- 1 XLM = 100 CHIP.
- table funds are locked in Soroban.
- table funds unlock after the active hand when leaving.
- disconnect policy belongs to the player.
- 3-node MPC design.
- tolerate one malicious MPC node.
- backend compromise must not imply player-fund compromise.
- split Soroban responsibilities rather than one monolithic contract.

---

## 42. Next Architecture Documents

Before mainnet production, this document should be followed by:

1. `docs/threat-model/THREAT_MODEL.md`
2. `docs/protocol/HAND_PROTOCOL.md`
3. `docs/protocol/SETTLEMENT_PROTOCOL.md`
4. `docs/protocol/MPC_DEALING.md`
5. contract invariant specifications
6. database schema
7. incident and recovery design

This document remains the top-level architecture source of truth.
