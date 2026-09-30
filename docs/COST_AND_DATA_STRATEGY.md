# Flopiq Cost and Data Strategy v1

Status: **Architecture companion**
Scope: backend cost control, database efficiency, retention, archival, and scaling gates.

This document is subordinate to `docs/ARCHITECTURE.md`. Security and correctness take priority over cost savings.

---

## 1. Core Principle

Flopiq should pay to store **facts**, not repeated copies of derived state.

For poker, the durable source of truth is primarily:

- player identity,
- table configuration,
- hand identity,
- ordered player actions,
- MPC/public verification data,
- final hand result,
- settlement digest/transaction,
- financial/audit events.

Intermediate UI state, repeated pot snapshots, rendered table state, and cache data should normally be derived from those facts.

---

## 2. Data Classes

### 2.1 Durable financial/security data

Must be retained durably:

- vault deposits/releases,
- cashier conversions,
- settlement records,
- hand IDs,
- settlement digests,
- rake records,
- contract transaction references,
- security/audit events required to explain a financial transition.

Never place the only copy of this data in Redis.

### 2.2 Durable poker data

Store compactly:

- one hand summary row,
- ordered action/event rows,
- player result rows,
- board/showdown data,
- SHOW/MUCK decisions,
- required MPC verification metadata.

Do not save a full serialized table snapshot after every action.

### 2.3 Ephemeral data

Examples:

- WebSocket presence,
- typing/UI state,
- short-lived reconnect metadata,
- rate-limit counters,
- transient matchmaking data,
- cached derived table state.

Use memory/Redis with TTL where useful.

Ephemeral data must be disposable without financial loss.

### 2.4 Cold/archive data

Older detailed hand transcripts, diagnostic logs, and large verification payloads should move to inexpensive object storage when they are no longer needed for frequent database queries.

PostgreSQL should retain a compact searchable summary and integrity hash/reference.

---

## 3. Hand Storage Model

Prefer an event-oriented hand record.

Conceptually:

```text
hands
  one compact row per hand

hand_players
  one compact row per participating player

hand_actions
  ordered canonical actions only

hand_results
  final contribution / payout / stack result

mpc_sessions
  compact verification metadata

archive object
  optional compressed full transcript / large proof material
```

Avoid:

```text
action #1 -> save full 9-player table snapshot
action #2 -> save another full table snapshot
action #3 -> save another full table snapshot
...
```

The deterministic Poker Core must be capable of rebuilding game state from the hand start plus ordered actions.

---

## 4. Recovery Without Snapshot Waste

For an active hand:

1. durably append validated actions with a monotonic sequence,
2. rebuild deterministic state from the action log after a crash,
3. optionally create a compact checkpoint at a street boundary if measurements show recovery is too slow.

Do not create a database snapshot for every action.

A Texas Hold'em hand is short enough that replaying its canonical action list should normally be inexpensive.

---

## 5. PostgreSQL Row Efficiency

Use compact strongly typed columns for frequently repeated data.

Recommended direction:

- internal numeric player ID for relational joins,
- store the Stellar wallet address once in the player identity table,
- `BIGINT` for CHIP amounts,
- `SMALLINT` or compact enums/codes for seat, street, and action type,
- UUID/compact binary identifiers where appropriate,
- timestamps only where they are operationally useful,
- JSON/JSONB only for genuinely flexible payloads.

Do not repeat a 56-character Stellar address on every action row when an internal player ID can reference it.

Do not store numeric CHIP amounts as strings or floating point.

---

## 6. JSON Policy

JSONB is useful for protocol/versioned metadata, but it should not become the default schema.

Prefer normal columns for:

- wallet/player,
- table,
- hand,
- seat,
- action,
- amount,
- sequence,
- street,
- timestamp,
- settlement status.

Use JSONB for:

- versioned MPC public metadata,
- optional configuration payloads,
- rare protocol extensions.

Large payloads should be archived/compressed rather than repeatedly embedded in hot rows.

---

## 7. Index Policy

Every index consumes storage and write I/O.

Create indexes from real query requirements rather than "index everything".

Initial high-value indexes should cover:

- hand by `hand_id`,
- hand by `(table_id, sequence)`,
- recent player-hand lookup,
- active table/player lookup,
- settlement transaction/digest uniqueness where required,
- monotonic action lookup by `(hand_id, sequence)`.

Avoid broad JSONB indexes unless a measured query needs them.

Review unused indexes periodically and remove them safely.

---

## 8. Recent-Hand Requirement

The product requires at least the player's latest 20 hands.

Hot-retention rule:

> PostgreSQL must always retain enough detailed data to return each player's latest 20 hands quickly.

A practical early policy:

- keep all detailed hands from the recent operational window in PostgreSQL,
- additionally guarantee the latest 20 per player remain hot even for inactive players,
- older detailed transcripts may be archived,
- keep the compact hand summary, result, integrity hash, and archive reference searchable.

The exact time window should be tuned from real usage rather than permanently fixed now.

---

## 9. Archive Format

For old hand transcripts or large public verification payloads:

1. produce one canonical hand transcript,
2. compute the protocol-defined integrity hash over the canonical representation,
3. compress for storage,
4. store in S3-compatible object storage,
5. retain the object key + digest + required summary in PostgreSQL.

A simple interoperable starting point is compressed JSON Lines / canonical JSON with Zstandard compression, but the final canonical serialization must be decided by the hand/settlement protocol specification.

Compression format must never change the data covered by the cryptographic digest.

---

## 10. Object Storage

Object storage is preferred over expensive PostgreSQL disk for cold data.

Good candidates for object storage:

- old hand transcripts,
- large audit bundles,
- exported security logs,
- database backups,
- build/release artifacts.

Do not make object storage part of the synchronous betting path.

An object-storage outage must not interrupt a player's normal action in an active hand.

---

## 11. Redis Policy

Redis is optional in the earliest implementation.

Add it only when the realtime architecture needs:

- cross-instance pub/sub,
- presence,
- distributed rate limiting,
- short locks/leases,
- ephemeral matchmaking state,
- reconnect cache.

Rules:

- use TTLs,
- no permanent hand history,
- no sole copy of a player balance,
- no sole copy of a settlement,
- no unlimited-growth keys.

At low traffic, in-process state plus PostgreSQL can be cheaper and simpler than introducing Redis immediately.

---

## 12. Log Retention

Application logs are a common hidden storage cost.

Use structured logs and levels.

Suggested classes:

### Keep longer

- security events,
- authentication anomalies,
- financial failures,
- contract settlement errors,
- MPC protocol failures.

### Short retention

- normal WebSocket connect/disconnect noise,
- successful routine requests,
- verbose development traces,
- repeated health checks.

Production debug logging should be disabled by default and temporarily enabled when investigating an incident.

Never log:

- wallet secrets,
- session secrets,
- private MPC shares,
- unrevealed hole cards outside the authorized protocol path.

---

## 13. Database Maintenance

Use normal PostgreSQL hygiene:

- autovacuum enabled,
- analyze tables,
- inspect slow queries,
- inspect table/index size,
- avoid high-churn unnecessary updates,
- prefer append-oriented hand/action records,
- delete expired ephemeral rows in bounded batches.

PostgreSQL already provides TOAST compression/out-of-line storage for sufficiently large variable-length values, but schema design should still avoid unnecessary large values in hot tables.

---

## 14. Partitioning

Do not partition the database merely because the feature exists.

Start simple.

Consider time partitioning for very large append-only tables such as `hand_actions` or audit events only after row counts/query plans show a real benefit.

Premature partitioning increases operational complexity.

---

## 15. Backup Strategy

Low cost must not mean no recovery.

Minimum production direction:

- automated database backups,
- backup copy outside the primary compute server/provider,
- encrypted backup storage,
- periodic restore test,
- retention tiers instead of keeping every backup forever.

Example retention policy to evaluate later:

- several recent daily restore points,
- fewer weekly restore points,
- fewer monthly restore points.

The exact schedule depends on database provider capabilities and regulatory requirements.

---

## 16. Cost-First Deployment Stages

### Stage A - Local development

Goal: almost zero infrastructure cost.

```text
Next.js             local/Vercel free
Node game server    local
PostgreSQL          local container or free managed tier
Redis               none unless needed
MPC nodes           3 local processes
Stellar             testnet
```

Do not pay for production redundancy here.

### Stage B - Shared private test environment

Goal: one small external server.

```text
Vercel/free static-web hosting
        |
one low-cost EU VPS
  |- game server
  |- PostgreSQL
  |- optional Redis
  |- development MPC processes
```

This is for testing, not real-money security isolation.

Keep encrypted backups outside that VPS.

### Stage C - Public test / low-value pilot

Separate database durability from the app if operational load justifies it.

Possible shape:

```text
Frontend
   |
Game Server VPS
   |
managed PostgreSQL OR carefully operated PostgreSQL
   |
object storage backups/archive
```

MPC nodes begin moving onto separate failure domains.

### Stage D - Real-money production

Security architecture becomes mandatory:

```text
Game Server
Managed/durable PostgreSQL
Optional Redis
MPC Node 1
MPC Node 2
MPC Node 3
Off-provider backups
Object archive
Monitoring
```

The three MPC nodes must not all share one machine or one security boundary.

---

## 17. Scaling Gates

Do not upgrade infrastructure because of guesses.

Upgrade when measurements cross defined thresholds.

Track at least:

- concurrent tables,
- concurrent WebSockets,
- game-server CPU/memory,
- PostgreSQL CPU,
- database size,
- action writes/sec,
- p95/p99 query latency,
- reconnect rate,
- archive growth,
- backup duration,
- MPC round latency.

Examples:

- add Redis when multiple game-server instances actually need shared ephemeral coordination,
- add another game-server instance when latency/CPU requires it,
- increase Postgres compute when measured query latency requires it,
- move old transcripts to archive before buying expensive database storage,
- add indexes only for measured query patterns.

---

## 18. Provider Portability

Flopiq should remain portable.

Avoid architecture that requires one proprietary database/host feature to function.

Preferred portable primitives:

- Linux,
- Node.js,
- PostgreSQL,
- Redis-compatible cache where needed,
- S3-compatible object storage,
- standard containers,
- Stellar/Soroban.

A provider change should be an operations task, not an application rewrite.

---

## 19. Cost Safety Rules

1. Security invariants are never weakened to save a few dollars.
2. Do not pay for services before the project needs them.
3. Do not store derived data repeatedly.
4. Do not use Redis as a durable database.
5. Do not keep unlimited debug logs.
6. Move cold bulky data to cheap object storage.
7. Measure before adding indexes, replicas, Redis, or larger machines.
8. Keep backups outside the primary failure domain.
9. Separate MPC nodes before real-money production.
10. Do not rely on a provider whose terms do not lawfully permit the project's operator to use the service.

---

## 20. Current Recommended Development Direction

For the next implementation phases:

- keep the deterministic Poker Core independent of infrastructure,
- use PostgreSQL as the only required application database,
- do not require Redis yet,
- model hand storage as compact canonical events rather than snapshots,
- make archive storage an interface so an S3-compatible backend can be added later,
- use one inexpensive external test server only when local development becomes inconvenient,
- postpone three separately hosted MPC nodes until integration/security testing,
- require full MPC separation before real-money production.

This keeps early infrastructure close to zero cost without creating an expensive migration later.
