# @cutils/mongo

Hand-rolled async MongoDB wire driver for scriptc: OP_MSG + BSON over
`node:net` / `node:tls` / `node:crypto` — **no FFI, no native deps**. The
same source runs under plain Node and lowers through `scriptc build`
into a single static ELF with the driver inside.

```ts
import { MongoClient } from "@cutils/mongo";

await using client = await MongoClient.connect({
  uri: "mongodb://localhost:27017",
  dbName: "app",
});

const todos = client.database().collection("todos");
const id = await todos.insertOne({ title: "ship it", done: false });

const cursor = todos.find({ done: false }, { sort: { title: 1 } });
for (let d = await cursor.next(); d !== null; d = await cursor.next()) {
  console.log(d.title);
}

await todos.updateOne({ _id: id }, { $set: { done: true } });
const n = await todos.deleteMany({ done: true });
```

## Surface

`MongoClient.connect(opts)` → `MongoClient` · `client.database(name?)` →
`Database` · `client.withSchema(schema)` → `Database` ·
`client.startTransaction(opts?)` → `Transaction` · `client.close()`.

`db.collection<TDoc>(name)` → `Collection<TDoc>` ·
`db.command(spec)` → `Document` · `db.startTransaction(opts?)`.

`Collection`: `insertOne` `insertMany` `findOne` `find` `updateOne`
`updateMany` `deleteOne` `deleteMany` `findOneAndUpdate`
`findOneAndDelete` `countDocuments` `estimatedDocumentCount` `distinct`
`bulkWrite` `aggregate`.

Cursors: `next()` `tryNext()` `hasNext()` `all()` `forEach(cb)`
`close()` `[Symbol.asyncDispose]`. `findOne` returns `TDoc | null`.

Values: `ObjectId` (`generate`, `fromHex`, `isHex`, `toHexString`,
`equals`), `Binary` (`bytes`, `subType`, `toUUID`), `BsonDate` (`ms`,
`toDate`, `toISOString`), `MongoError` (`code`, `codeName`).

## Standard Schema seam

`client.withSchema(schema)` returns a `Database` whose reads validate
through `schema["~standard"].validate` — any Standard Schema v1
conforming library (`@chttp/val`, valibot, zod/v4-standard). Documents
are validated in their plain-TS view: `ObjectId` → hex string,
`BsonDate` → ISO string, `Binary` → `Uint8Array`.

## BSON subset

Shipped: double, string, object, array, binary, objectId, boolean,
date, null, regex, int32, int64. Decoded dates come back as `BsonDate`
(program class — a `Date` can't live in an `unknown` record slot under
scriptc; encode accepts `Date`, `BsonDate`, or `{ $bson: "date", v }`).

**int64 reads back as `number` — lossy above 2^53.** Below
`Number.MAX_SAFE_INTEGER` it's exact; above it the value is silently
rounded (the tagged union keeps the full `bigint` in `raw`
internally, but the user-facing view is `number`). If you store big
integers, read them via `db.command` or store them as strings.

Punted types (decimal128, timestamp, dbRef, symbol, code, minKey,
maxKey) decode to `null`; encode never emits them.

## Production note: replica sets & failover

v1 has **no SDAM** (server discovery and monitoring): one socket to the
first seed host, no topology tracking. `retryReads`/`retryWrites`
reconnect **once to the same seed** on a network error — they do not
reselect a new primary. On Atlas (always a replica set), a primary
step-down kills the connection; the next command retries once against
the _old_ primary and fails. The v1 recovery story: catch the error,
re-`connect()` (which re-resolves `mongodb+srv://` and re-runs hello +
auth), and retry at the application level. Full SDAM is the v2
follow-up.

## mongoose users: what changed

- No `createIndex` / `listCollections` / schema builders / hooks —
  use the passthrough: `db.command({ createIndexes: "todos", indexes:
[{ key: { title: 1 }, name: "by_title" }] })`,
  `db.command({ listCollections: 1 })`, `db.command({ ping: 1 })`.
- Documents are plain records; `_id` is our `ObjectId` class
  (`id.toHexString()`, `ObjectId.fromHex(s)`).
- **int64 values read back as lossy `number`** (see above) — there is
  no `Long` wrapper.
- Cursors are explicit (`next`/`all`/`close`), not async iterators —
  the subset doesn't lower `for await`.
- Errors are `MongoError` with numeric `code` + string `codeName`
  (`"DuplicateKey"`, `"Validation"`, `"NetworkError"`, ...).

## Compatibility

| Server                   | Status                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| mongod/mongos 5.x+       | full v1 surface                                                                   |
| Atlas (`mongodb+srv://`) | works — TLS + SCRAM-SHA-256; A-record fallback for SRV (best-effort, single-seed) |
| Cosmos DB (RU)           | works — no transactions                                                           |
| DocumentDB               | works — no transactions, limited findAndModify                                    |
| FerretDB 2.x             | expected full wire compat                                                         |

## Notes

- `mongodb+srv://` resolves via IPv4 `dns.lookup` (the subset's only
  DNS API): single-seed best-effort. Explicit host lists work fine.
- Auth: SCRAM-SHA-1 / SCRAM-SHA-256 from `user:pass@` in the URI or
  `authMechanism=` option; `authSource=` honored.
- Docs: [integration](./docs/integration.md) ·
  [schema](./docs/schema.md) · [bson](./docs/bson.md) ·
  [compat](./docs/compat.md) ·
  [subset quirks](./docs/subset-quirks.md)
