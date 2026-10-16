# @cutils/mongo

Hand-rolled async MongoDB wire driver for scriptc — OP_MSG + BSON over
`node:net` / `node:tls` / `node:crypto`, no FFI. The same source runs
under Node and lowers through `scriptc build` into a single static ELF
that talks to mongod over the wire.

```ts
import { MongoClient } from "@cutils/mongo";

await using client = await MongoClient.connect({
  uri: "mongodb://localhost:27017",
  dbName: "app",
});

const todos = client.database().collection("todos");
const id = await todos.insertOne({ title: "ship it", done: false });
const open = await todos.find({ done: false }).all();
```

## Surface

| API | Notes |
| --- | --- |
| `MongoClient.connect(opts)` | hello + optional SCRAM-SHA-1/256; one socket |
| `client.database(name?)` / `db.collection<TDoc>(name)` | handles are free |
| `client.withSchema(schema)` | Standard-Schema v1 seam on reads |
| insert/update/delete/find/aggregate/bulkWrite family | OP_MSG commands |
| `next/tryNext/hasNext/all/forEach/close` | explicit cursors, no async iterator |
| `db.command(spec)` | raw command passthrough (`$db` stamped) |
| `client.startTransaction(opts?)` | replica sets only; `close()` rolls back |
| `ObjectId` / `Binary` / `BsonDate` / `MongoError` | value + error types |

## BSON subset

11 types shipped (double, string, object, array, binary, objectId,
boolean, date, null, regex, int32, int64). Decoded dates are `BsonDate`
(subset-safe `Date` twin); int64 reads back as `number` — **lossy
above 2^53**. Punted types decode to `null`.

## Production notes

Single connection, no SDAM: `retryReads`/`retryWrites` reconnect once
to the *same* seed — a primary step-down needs an app-level
re-`connect()`. `mongodb+srv://` resolves via best-effort IPv4
`dns.lookup` (no SRV records in the subset).

## Docs in this package

- `packages/mongo/docs/integration.md` — connect opts, URI forms,
  commands, error codes.
- `packages/mongo/docs/schema.md` — the Standard-Schema seam.
- `packages/mongo/docs/bson.md` — type table, BsonDate, int64 caveats.
- `packages/mongo/docs/compat.md` — Atlas/Cosmos/DocumentDB/FerretDB
  matrix, transactions.
- `packages/mongo/docs/subset-quirks.md` — the tagged-union internals.
