# Compatibility matrix

| Server             | Status   | Notes                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| mongod/mongos 5.x+ | full v1  | OP_MSG, SCRAM-SHA-1/256, transactions on replica sets                                       |
| Atlas              | works    | `mongodb+srv://` + first-byte TLS + SCRAM-SHA-256; single-seed A-record resolution (no SRV) |
| Cosmos DB (RU)     | works    | TLS required; **no transactions** (API returns them unsupported); SCRAM ok                  |
| DocumentDB         | works    | no transactions; some tiers lack `findAndModify` — use update+find                          |
| FerretDB 2.x       | expected | full wire compatibility vs mongod                                                           |

## Single-connection v1

One socket, first seed only, no SDAM. `retryReads`/`retryWrites` give
one reconnect to the _same_ seed on a network error — they do not
reselect after a primary step-down. Replica-set failover story for v1:
catch, re-`connect()`, retry at the application level.

## Transactions

Multi-document transactions work where the server supports them
(replica sets / sharded clusters). Standalone mongod, Cosmos, and
DocumentDB reject `txnNumber` with `IllegalOperation`
(`codeName` on the thrown `MongoError`). `Transaction.close()` /
`await using` rolls back when still active.

## Limits

- `findAndModify` isn't in every DocumentDB tier — fall back to
  `updateOne` + `findOne`.
- Cosmos caps request size — `insertMany`/`bulkWrite` chunk at the
  application level for large batches.
- `listCollections`, `createIndexes`, user admin: via `db.command`.
