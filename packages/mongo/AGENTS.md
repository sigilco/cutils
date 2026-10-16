# @cutils/mongo — agent notes

Hand-rolled async MongoDB wire driver for the scriptc subset: OP_MSG +
BSON over `node:net` / `node:tls` / `node:crypto`. **No FFI** — the same
source runs under plain Node and lowers into a single static ELF.

Spec of record: `.agents/plans/2026-10-15-cutils-mongo.md`.

## Layout

- `src/index.ts` — public surface: `MongoClient`, `Database`,
  `CollectionCore` (+ `Collection<TDoc>` interface alias), `FindCursorCore`,
  `AggregateCursorCore`, `Transaction`, exports for `ObjectId`, `Binary`,
  `BsonDate`, `MongoError`, types.
- `src/types.ts` — option records + the Standard Schema class twin
  (`StdProps` / `StandardSchemaV1` — same pattern as sqlite; `import type`
  from `@standard-schema/spec` is refused).
- `src/errors.ts` — `MongoError{code,codeName,message}` + `codeNameFor`
  (client-side code -> name fallback; server `writeErrors` omit codeName).
- `src/bson/` — `objectid.ts`, `binary.ts`, `value.ts` (the `BsonValue`
  tagged union + `BsonDoc` + `BsonDate` + user<->wire converters).
- `src/internal/` — `bson.ts` (encoder/decoder), `opmsg.ts` (frame
  sections 0/1), `socket.ts` (SocketChannel + connectTcp/connectTls),
  `tls` folded into socket.ts, `uri.ts` (mongodb:// + mongodb+srv://),
  `auth.ts` (SCRAM-SHA-1/256), `commands.ts` (spec builders),
  `session.ts` (hello + auth + command + retry + txn stamping),
  `cursor.ts`, `transaction.ts` (TxnState), `utf8.ts`.
- `gate.ts` — scriptc coverage gate + ELF smoke program (env-free).
- `test/` — `bson.test.mjs` (round-trip vs official `bson` devDep),
  `opmsg.test.mjs`, `auth.test.mjs` (SCRAM vectors),
  `cursor.test.mjs` (fake session), `mongo.test.mjs` +
  `parity.test.mjs` (live, gated on `MONGO_TEST_URI`),
  `coverage.test.mjs`, `elf.test.sh`.

## Subset deltas beyond the root AGENTS.md bans

- `Document` is `{ [k: string]: unknown }`, not the spec's recursive
  `BsonPrimitive | Document | BsonPrimitive[]` union — index signatures
  over class unions are SC2006-refused. Public contract is identical.
- Decoded BSON dates produce `BsonDate` (program class with `ms`,
  `toDate()`, `toISOString()`), not `Date` — a `Date` can't live in an
  `unknown` record slot under scriptc (native-handle dynamic repr).
  Encode accepts `Date`, `BsonDate`, or `{ $bson: "date", v: ms }`.
- Wire values are the `BsonValue` tagged union (12 arms for the 11
  shipped BSON types + the `{ kind: "object" }` document arm). Records
  of tagged unions are concrete; records of `unknown` are not.
- `Collection<TDoc>` / `FindCursor<TDoc>` / `AggregateCursor<TOut>` ship
  as concrete `*Core` classes + `interface X<T> extends XCore` +
  `const X = XCore` (generic class instances degrade to methodless
  shells). No `as unknown as` casts — the interface adds no members, so
  the core is directly assignable.
- `typeof x === "undefined"` over an index-access operand is SC1090 —
  bind `const v = doc[k]` first.
- `Uint8Array.indexOf` isn't lowered — scan for the byte.
- Async-method overrides on subclasses are SC1090 — the transaction
  stamps lsid/txnNumber inside `Session.command` (via `activeTxn`)
  instead of subclassing the collection.
- `Map`/`Set` are lifted since scriptc 0.3.3 (probe-verified), but this
  package doesn't use them.
- `s.write()` returns `void`, the `close` handler takes no args,
  `tls.connect({socket})` upgrade is not lowered (MongoDB TLS is
  first-byte — `tls.connect(port, host, opts)` direct).

## BSON subset (11 shipped, 7 punted)

Shipped: double, string, object, array, binary, objectId, boolean,
date, null, regex, int32, int64. Punted: decimal128, timestamp, dbRef,
symbol, code(+scope), minKey, maxKey — decode skips their bytes and
yields `null` for the field; encode never emits them.

## Compat matrix (targets)

- mongod/mongos 5.x+ (OP_MSG): full v1 surface.
- Atlas: `mongodb+srv://` + TLS (first-byte) + SCRAM-SHA-256 — works;
  SRV resolution is best-effort A-record (no DNS SRV in the subset).
- Cosmos DB (RU): OP_MSG + SCRAM — workarounds documented in
  docs/compat.md (no transactions).
- DocumentDB: OP_MSG — no transactions, no `findAndModify` on some
  tiers.
- FerretDB 2.x: full wire compatibility expected.

v1 has NO SDAM/server selection: one socket to the first seed.
`retryReads`/`retryWrites` reconnect ONCE to the same seed — they do
not reselect after a primary step-down.

## Don't ship

Connection pool, async iterators, exhaust cursors, change streams,
decimal128/timestamp/DbRef encode, `for await`, FFI.
