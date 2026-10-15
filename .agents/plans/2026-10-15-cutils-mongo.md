# @cutils/mongo — async, document-oriented, Standard-Schema seam, 2026-10-15

## What this is

Hand-rolled, async, TCP+TLS MongoDB wire-protocol driver for chttp apps,
shipped as a TypeScript package that compiles to a single static binary
with `scriptc build`. Same Standard-Schema-seam skeleton as
`@cutils/sqlite` and `@cutils/postgres` (formerly val-first;
better-sqlite3 + drizzle-orm inspired shape), but document-oriented
(MongoDB `OP_MSG` + BSON) and aimed at the MongoDB compat
ecosystem: MongoDB Atlas, Azure CosmosDB for MongoDB, AWS
DocumentDB, and FerretDB.

**Same Standard-Schema-seam design as the other two DBs:** the user
writes ONE schema, hands it to `db.collection<TDoc>(name, schema)`,
and `InferOutput<typeof schema>` is the document type. The schema can
be `@chttp/val`, valibot (verified compiling under scriptc 0.3.3,
open-circle/valibot#1708 pending), or any Standard Schema v1
conforming validator. The same schema is used for read AND write;
inserts are lenient via `WithoutId<TDoc>`. No `withSchema` chain
(subset-banned method shorthand), no codegen, no column DSL. The seam
is Standard Schema v1: validation runs `schema["~standard"].validate`.
See `.agents/memory/cutils_db_val_first.md` for the family design
rules.

**No blocker.** The old val type-brand prerequisite (the `_t!: T`
declared fields on each `VSchema` subclass, so `InferOutput<S>`
returns the typed object shape instead of
`{ [k: string]: unknown }`) stays a val-side ticket (T0b) and no
longer gates this package: typed output flows through the
Standard-Schema `InferOutput` alias and runtime validation through
`schema["~standard"].validate`, so coarse val `InferOutput` only
weakens compile-time types, never the runtime.

## Why third (after sqlite and postgres)

- **Compatibility ecosystem is the value.** CosmosDB, DocumentDB, and
  FerretDB together represent a substantial fraction of "MongoDB users
  who want to leave Atlas" — this is the same kind of compatibility
  surface as Postgres (Neon + Supabase + RDS) was for `@cutils/postgres`.
  One driver, four deploy targets, one wire protocol, one subset-clean
  surface.
- **Hand-rolled, not vendored.** `mongodb` (Apache-2.0) is the
  obvious vendor target but it has ~3,000 LoC of subset-banned code:
  `Map`/`Set` everywhere, `Reflect.metadata`, decorators via
  `@typegoose` style, async generators, EventEmitter subclassing,
  monkeypatched cursor setters, ObjectId + Long + Decimal128 classes
  with private fields and `unknown` slots. Patch cost equals hand-roll
  cost. The user decided this.
- **No FFI.** Same as `@cutils/postgres`: `node:net` + `node:tls` +
  `node:crypto` + TypeScript. The BSON parser/serializer is hand-rolled
  but is in TS, not C.
- **Pool-friendly without shipping a pool.** Same pattern as
  `@cutils/postgres`: `MongoClient.connect()` returns one client; the
  class shape is pool-friendly by construction; v1 ships no `Pool`
  class.
- **Typegoose's result, not its mechanism.** Typegoose gives you a
  typed model from a decorated class. We replicate the *result*
  (`Collection<TDoc>`) without the mechanism (decorators are
  subset-banned). The user writes a plain TS type and gets a typed
  collection back.

## Non-goals

- A connection pool. **v1 ships no `Pool` class.** Same reasoning as
  `@cutils/postgres` lines 47-58: (a) single-connection is correct for
  the typical managed-Mongo workload; (b) every pool wants different
  semantics; (c) the public surface is pool-friendly out of the box.
  A user-side pool is ~50-100 LoC. Future v2 `@cutils/mongo-pool` is a
  separate ticket.
- An ORM, query builder, schema DSL, or migration tool. We ship the
  typed collection and the wire operations; the user writes the
  document type and the aggregation pipeline. `mongoose-style`
  `Schema.Types.X` mapping, `populate()`, `aggregate()` pipeline
  validation, all out of scope.
- Change streams (`watch()`). Subset-hostile (async generator + heart-
  beats + resumability). Not implemented by FerretDB. Punted.
- Atlas Search indexes. Atlas-only; not on Cosmos/DocumentDB/FerretDB.
- Client-side field-level encryption. Atlas-only (libmongocrypt). v2
  ticket.
- GridFS. BSON classes we don't ship (`Binary` subType 0x02 streams,
  large file chunks). Punt.
- BSON types we punt: `Decimal128`, `Timestamp`, `DBRef`, `Symbol`,
  `Code`/`CodeWScope`, `MinKey`/`MaxKey`. Users model them as plain
  TS (`string` for `Decimal128`, etc.) and the wrapper round-trips
  them as wire-opaque blobs.
- Replica-set server selection. v1 is single host (`mongodb://host:port`
  or `mongodb+srv://` resolved to a single host). SDAM topology is a
  v2 ticket.
- Mongoose-style middleware (`pre`/`post` hooks), plugins, virtuals,
  discriminators, hydrate. All monkeypatching on schema state.
- Vendor `mongodb`, vendor `mongoose`, vendor `typegoose`, vendor
  `bson`. Hand-roll.

## Public surface

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";

type InferOutput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
import {
  MongoClient, Database, Collection,
  FindCursor, AggregateCursor, Transaction,
  ObjectId, Binary, MongoError,
} from "@cutils/mongo";

// ---------- BSON primitives
export class ObjectId {
  // 12 bytes packed; subset-clean (no `unknown` slots)
  bytes: Uint8Array;
  constructor(bytes?: Uint8Array);
  toHexString(): string;
  equals(other: ObjectId): boolean;
  toString(): string;          // hex
  static isHex(input: unknown): boolean;
  static fromHex(hex: string): ObjectId;
  static generate(): ObjectId; // time + process-unique + counter
}

export class Binary {
  bytes: Uint8Array;
  subType: number;             // 0 = generic, 4 = UUID, etc.
  constructor(bytes: Uint8Array, subType?: number);
  toUUID(): string;            // subtype 4
}

export type BsonPrimitive =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | ObjectId
  | Binary;

export type Document = {
  [k: string]: BsonPrimitive | Document | BsonPrimitive[];
};

export type WithId<T> = T & { _id: ObjectId };
export type WithoutId<T> = Omit<T, "_id">;

// ---------- errors
export class MongoError extends Error {
  code: number;                // server error code (11000 duplicate key, etc.)
  codeName: string;            // "DuplicateKey", "NetworkTimeout", etc.
  constructor(fields: {
    code: number;
    codeName: string;
    message: string;
  });
}

// ---------- client
export interface ConnectOpts {
  uri: string;                              // mongodb:// or mongodb+srv://
  dbName: string;                           // logical default database
  appName?: string;
  connectTimeoutMs?: number;                // default 10000
  serverSelectionTimeoutMs?: number;        // default 30000
  retryReads?: boolean;                     // default true
  retryWrites?: boolean;                    // default true
  tls?: "off" | "preferred" | "required";   // default "preferred" or "required"
}

export class MongoClient implements AsyncDisposable {
  static async connect(opts: ConnectOpts): Promise<MongoClient>;

  readonly uri: string;
  readonly dbName: string;

  database(name: string): Database;

  // Standard-Schema seam: schema is the second arg, NOT chained via
  // withSchema(). Returns a Database where collection<TDoc>(name)
  // defaults to the schema's output type.
  withSchema<Schema extends StandardSchemaV1>(schema: Schema):
    Database;   // re-projects collection(name) to Collection<InferOutput<Schema>>

  startTransaction(opts?: TransactionOpts): Promise<Transaction>;

  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------- database
export class Database {
  readonly name: string;
  readonly client: MongoClient;

  // Standard-Schema seam: TDoc defaults to the schema's InferOutput
  // if withSchema was used; otherwise defaults to `Document`. The
  // schema is the second argument; not a chain.
  collection<TDoc extends Document = Document>(name: string):
    Collection<TDoc>;

  command(spec: Document): Promise<Document>;

  startTransaction(opts?: TransactionOpts): Promise<Transaction>;

  [Symbol.asyncDispose](): Promise<void>;
}

// ---------- collection
export interface FindOpts {
  projection?: { [k: string]: 0 | 1 };
  sort?: { [k: string]: 1 | -1 };
  limit?: number;
  skip?: number;
  maxTimeMs?: number;
  batchSize?: number;
  readPreference?: "primary" | "primaryPreferred" | "secondary" | "secondaryPreferred" | "nearest";
}

export class Collection<TDoc extends Document = Document> {
  readonly database: Database;
  readonly name: string;
  readonly schema: StandardSchemaV1 | null;  // null unless via withSchema

  // ---- CRUD. Insert accepts WithoutId<TDoc> (lenient: server assigns _id).
  insertOne(doc: WithoutId<TDoc>): Promise<{ insertedId: ObjectId }>;
  insertMany(
    docs: ReadonlyArray<WithoutId<TDoc>>,
  ): Promise<{ insertedIds: ObjectId[]; insertedCount: number }>;

  findOne(filter: Partial<TDoc>): Promise<TDoc | null>;
  find(filter?: Partial<TDoc>, opts?: FindOpts): FindCursor<TDoc>;

  updateOne(
    filter: Partial<TDoc>,
    update: Document,
    opts?: { upsert?: boolean },
  ): Promise<{
    matchedCount: number;
    modifiedCount: number;
    upsertedId: ObjectId | null;
  }>;
  updateMany(
    filter: Partial<TDoc>,
    update: Document,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  deleteOne(filter: Partial<TDoc>): Promise<{ deletedCount: number }>;
  deleteMany(filter: Partial<TDoc>): Promise<{ deletedCount: number }>;

  findOneAndUpdate(
    filter: Partial<TDoc>,
    update: Document,
    opts?: { returnDocument?: "before" | "after"; upsert?: boolean },
  ): Promise<TDoc | null>;

  findOneAndDelete(filter: Partial<TDoc>): Promise<TDoc | null>;

  countDocuments(filter?: Partial<TDoc>): Promise<number>;
  estimatedDocumentCount(): Promise<number>;
  distinct<K extends keyof TDoc>(key: K): Promise<NonNullable<TDoc[K]>[]>;

  bulkWrite(ops: ReadonlyArray<WriteOp<TDoc>>): Promise<BulkWriteResult>;

  // Aggregation: pipeline is opaque to us; we ship it verbatim and
  // return a cursor. TOut defaults to TDoc.
  aggregate<TOut = TDoc>(pipeline: Document[]): AggregateCursor<TOut>;
}

export type WriteOp<TDoc> =
  | { type: "insert"; doc: WithoutId<TDoc> }
  | { type: "updateOne"; filter: Partial<TDoc>; update: Document; upsert?: boolean }
  | { type: "updateMany"; filter: Partial<TDoc>; update: Document; upsert?: boolean }
  | { type: "deleteOne"; filter: Partial<TDoc> }
  | { type: "deleteMany"; filter: Partial<TDoc> }
  | { type: "replaceOne"; filter: Partial<TDoc>; replacement: WithoutId<TDoc>; upsert?: boolean };

export interface BulkWriteResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  deletedCount: number;
}

// ---------- cursors. No async generator (subset-fenced).
export class FindCursor<TDoc> implements AsyncDisposable {
  next(): Promise<TDoc | null>;
  tryNext(): Promise<TDoc | null>;
  hasNext(): Promise<boolean>;
  all(): Promise<TDoc[]>;
  forEach(cb: (doc: TDoc) => boolean | void): Promise<void>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export class AggregateCursor<TOut> implements AsyncDisposable {
  // same six methods, parameterized on TOut
  next(): Promise<TOut | null>;
  tryNext(): Promise<TOut | null>;
  hasNext(): Promise<boolean>;
  all(): Promise<TOut[]>;
  forEach(cb: (doc: TOut) => boolean | void): Promise<void>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------- transaction
export interface TransactionOpts {
  readConcern?: "local" | "majority" | "snapshot";
  writeConcern?: "majority" | { w: number; j?: boolean };
}

export class Transaction implements AsyncDisposable {
  readonly client: MongoClient;

  // Inside a transaction, calls go through `tx.database(name)`;
  // collection methods carry the session implicitly.
  database(name: string): Database;

  commit(): Promise<void>;        // auto on clean dispose
  rollback(): Promise<void>;      // auto on dispose-after-throw
  [Symbol.asyncDispose](): Promise<void>;
}
```

### Why this shape (Standard-Schema seam)

1. **The seam is the schema library, not val specifically.** The
   wrapper types schemas as `StandardSchemaV1` (type-only import from
   `@standard-schema/spec`; types erase at compile) and validates via
   `schema["~standard"].validate(doc)`. `@chttp/val` and valibot are
   both first-class conforming validators; the rest of chttp (HTTP
   body validation) already uses val, so val stays the default in
   examples. Convergent seam across the whole app.

2. **Schema attached at construction, not chained.** The schema is
   the second arg to `db.collection<TDoc>(name, schema)` or
   `mongo.withSchema(schema)` — *not* a fluent `collection.withSchema(s)`
   chain. `withSchema` as a method name is subset-banned method
   shorthand; the schema belongs with the collection anyway. Same
   principle as `@cutils/sqlite`'s `prepare(sql, schema)`:

   ```ts
   // Standard-Schema seam. Schema is the second arg to withSchema.
   await using mongo = await MongoClient.connect({ uri, dbName: "app" });
   const db = mongo.withSchema(UserSchema);
   const users = db.collection<UserDoc>("users");
   // users.schema === UserSchema
   ```

3. **One schema for read AND write.** `users.findOne` and
   `users.find` validate the wire-decoded document (BSON classes
   unwrapped to plain TS) against the schema. `users.insertOne` and
   `users.insertMany` validate the user's input the same way. Same
   pattern as `@cutils/sqlite`/`@cutils/postgres`; one schema
   across all operations.

4. **Inserts are lenient via `WithoutId<TDoc>`.** The user provides
   the document without `_id`; the server assigns an `ObjectId`. The
   schema's `_id` field is optional in the wire-decoded view; the
   insert payload doesn't need to specify it. Mirrors
   `@cutils/sqlite`'s `Partial<TRow>` for autoincrement PKs.

5. **BSON classes are not schema types.** `ObjectId` and `Binary` are
   plain TS wrapper classes that participate in BSON wire encoding.
   No validator in the family ships `objectId()`/`binary()` factories
   (val's `packages/val/src/factories.ts:34-211` is the complete
   surface, no BSON types). At the wire boundary, the wrapper unwraps
   `ObjectId → hex string` and `Binary → Uint8Array` before schema
   validation runs. The user's `TDoc` keeps `ObjectId`/`Binary` as
   the source of truth; the schema validates the plain-TS view.

6. **`findOne` returns `TDoc | null`, not `TDoc | undefined`.**
   Subset rule (`| undefined` is banned). `null` is the natural
   not-found return for MongoDB. No `findOneOrUndefined` parallel
   needed — the rule is satisfied by default.

7. **`await using` everywhere.** `MongoClient`, `Database`,
   `FindCursor`, `AggregateCursor`, `Transaction` all implement
   `AsyncDisposable` with zero-arg `[Symbol.asyncDispose]()`. Confirmed
   in scriptc 0.3.3 (memory `scriptc_using_audit.md`).

8. **No `Pool` class in v1.** Same pool-friendly-by-construction
   pattern as `@cutils/postgres`. `MongoClient.connect()` returns one
   client; users can write their own pool in ~50-100 LoC. Future
   v2 `@cutils/mongo-pool` is a separate ticket.

9. **No async generator (`for await ... of` is fenced).** Cursor
   iteration is via `next()`, `tryNext()`, `hasNext()`, `all()`,
   `forEach(cb)`, or `[Symbol.asyncDispose]()`. `for (const d of
   await c.all()) {}` is the user pattern.

10. **No EventEmitter, no monkeypatching.** The official `mongodb`
    driver emits a storm of events (`serverHeartbeatStarted`,
    `connectionPoolCreated`, etc.). All subset-hostile; all dropped.
    Users who need observability wrap `MongoClient.connect()` and
    the `command()` calls in their own logger.

11. **Validation mechanics.** `schema["~standard"].validate(doc)`
    returns `{ value }` or `{ issues }`; typed output uses the local
    alias `type InferOutput<S extends StandardSchemaV1> =
    StandardSchemaV1.InferOutput<S>`. Property access on
    `schema["~standard"]` is declared-structural, so it stays
    subset-clean (no SC1090 fencing).

### What we DON'T ship (and why)

The drop list is long but principled — every drop is "subset-banned
or subset-hostile AND user-hostile":

| Dropped | Reason |
| --- | --- |
| `[Symbol.asyncIterator]()` on cursors | `async function*` is subset-fenced |
| `cursor.stream()` | `node:stream` `Readable` is too heavy; not subset-clean |
| `cursor.map(fn)`, `cursor.rewind()`, `cursor.clone()` | One-shot cursors; mutation-after-construction |
| `cursor.withReadPreference()`, `cursor.addCursorFlag()` | Chain-setter monkeypatching |
| `MongoClient.startSession()` / `withSession(fn)` | Closure form; user-banned; sessions are internal to transactions |
| `Session.prototype.x` surface | All internal to the wire layer; not user-facing |
| `MongoClient.on("event", fn)` / EventEmitter | Subset-hostile; observability v2 |
| `Collection.watch(pipeline)` | Change streams; async generator + heartbeats; FerretDB doesn't support |
| `Collection.createSearchIndex()` etc. | Atlas Search only; not on Cosmos/DocumentDB/FerretDB |
| `Collection.populate()` | Mongoose-style cross-collection join; v2 if asked |
| `Model.pre('save', fn)` / `Schema.plugin()` | Mongoose middleware; monkeypatching on schema state |
| `Schema.virtual().get(fn)` | Function value in record; subset ban |
| `Model.discriminator()` | Mongoose inheritance; subset-hostile |
| `Model.hydrate()` | Mongoose internal doc state |
| `pkFactory: () => ObjectId` | Function value in record; subset ban |
| `Collection.createIndex()` etc. | v2 ticket; user runs `db.runCommand` for now |
| `Collection.drop()`, `renameCollection()` | CLI concerns |
| `Db.createCollection()`, `listCollections()` | Introspection v2 |
| `MongoClient.appendMetadata()`, `checkForNonGenuineHosts()` | Atlas branding check; subset-banned |
| `autoEncrypter`, `autoEncryption` | Client-side field-level encryption; Atlas-only |
| `bulkWrite` partial | Ship it; on FerretDB it errors server-side. Documented. |
| `multi-doc transactions` partial | Ship `startTransaction()`; DocumentDB/Atlas OK; FerretDB errors; Cosmos single-collection only |
| BSON `Decimal128`, `Long` (class with arithmetic), `Timestamp`, `DBRef`, `Symbol`, `Code`, `MinKey`, `MaxKey` | Pun — store as plain TS (`string`, `number`, etc.) |

## BSON subset mapping (v1)

| BSON type tag | Wire | TS user-facing | Wrapper class? |
| --- | --- | --- | --- |
| `double` (0x01) | 8 bytes IEEE 754 | `number` | No — primitive |
| `string` (0x02) | int32 + UTF-8 | `string` | No — primitive |
| `object` (0x03) | nested BSON | `{ [k: string]: BsonValue }` | Recursive |
| `array` (0x04) | nested BSON w/ string keys "0", "1", … | `BsonValue[]` | Recursive |
| `binary` (0x05) | int32 + 1B subtype + bytes | `Uint8Array` | **`class Binary`** |
| `objectId` (0x07) | 12 bytes packed | `string` (24 hex) OR `ObjectId` | **`class ObjectId`** |
| `boolean` (0x08) | 1 byte | `boolean` | No — primitive |
| `date` (0x09) | int64 ms | `Date` | No — JS primitive |
| `null` (0x0A) | 0 bytes | `null` | No — primitive |
| `regex` (0x0B) | 2 cstrings | `{ pattern: string; options: string }` | No — record |
| `int32` (0x10) | 4 bytes | `number` | No — primitive |
| `int64` (0x12) | 8 bytes | `number` (lossy) | No — primitive |
| `decimal128` (0x14) | 16 bytes | `string` (PUNTED) | — |
| `timestamp` (0x11) | 8 bytes | `string` (PUNTED) | — |
| `dbRef` (0x0C) | nested BSON | `Document` (PUNTED) | — |
| `symbol` (0x0E) | int32 + UTF-8 | `string` (PUNTED, deprecated by BSON) | — |
| `code` (0x0D), `codeWScope` (0x0F) | — | (PUNTED, server-side JS, blocked on all targets) | — |
| `minKey` (0xFF), `maxKey` (0x7F) | — | (PUNTED, sentinel types) | — |

**11 BSON types we ship; 7 we punt.** The 11 cover MongoDB Atlas,
CosmosDB, DocumentDB, and FerretDB for the 80% case. Punted types
round-trip as their plain-TS view (string, number, etc.) — the wire
keeps them opaque.

### `ObjectId` — the most important BSON type

```ts
// src/bson/objectid.ts
export class ObjectId {
  bytes: Uint8Array;                  // 12 bytes, packed layout
  constructor(bytes?: Uint8Array) { this.bytes = bytes ?? generate(); }
  toHexString(): string { /* 24 hex chars */ }
  equals(other: ObjectId): boolean { /* bytes compare */ }
  toString(): string { return this.toHexString(); }
  static isHex(input: unknown): boolean { /* /[0-9a-f]{24}/ */ }
  static fromHex(hex: string): ObjectId { /* parse + set */ }
  static generate(): ObjectId { /* time + process-unique + counter */ }
}
```

~50-60 LoC. All concrete fields, no `unknown`, no private slots that
scriptc would barf on. Wire encoding is a fixed 12-byte format.

### `Binary`

```ts
// src/bson/binary.ts
export class Binary {
  bytes: Uint8Array;
  subType: number;                    // 0 = generic, 4 = UUID, etc.
  constructor(bytes: Uint8Array, subType: number = 0) {
    this.bytes = bytes;
    this.subType = subType;
  }
  toUUID(): string { /* subtype 4 → UUID string */ }
}
```

~30 LoC.

### Wire internal types — tagged union, not `unknown`

```ts
// src/internal/bson.ts
type BsonValue =
  | { kind: "double"; v: number }
  | { kind: "string"; v: string }
  | { kind: "object"; v: BsonDocument }
  | { kind: "array"; v: BsonValue[] }
  | { kind: "binary"; v: Uint8Array; subType: number }
  | { kind: "objectId"; v: string }           // hex on the wire
  | { kind: "boolean"; v: boolean }
  | { kind: "date"; v: number }               // ms
  | { kind: "null" }
  | { kind: "int32"; v: number }
  | { kind: "int64"; v: number };             // lossy to number at boundary

interface BsonDocument { [k: string]: BsonValue; }
```

The reader/writer classes take `BsonDocument` and `Uint8Array` —
concrete types, no `unknown` fields, no generics on the class.
Subset-clean.

## Wire protocol (hand-rolled)

| Component | LoC estimate | Source |
| --- | --- | --- |
| OP_MSG framing (header + section kinds 0/1) | ~150-200 | MongoDB wire spec |
| BSON parser/serializer (11 types) | ~2,000-2,500 | Hand-rolled; `Long`/`Decimal128` arithmetic punted |
| BSON classes (`ObjectId`, `Binary`) | ~80-100 | Subset-clean (concrete fields) |
| `insert`/`find`/`update`/`delete`/`aggregate` command shape | ~50 each = ~250 | JSON-to-BSON command conversion |
| SCRAM-SHA-1/256 auth | ~250-400 | Reference `PerryTS/postgres/src/auth/scram.ts` |
| MongoDB-specific commands (`hello`, `ismaster`, `saslStart`, `saslContinue`, `buildInfo`, `getMore`, `killCursors`) | ~300-500 | Wire-level only |
| **Total** | **~3,000-4,000 LoC** | Single-author scope |

**No FFI, no C shim, no amalgamation.** The BSON parser is in TS.
Subset-clean because the BSON grammar is recursive but always
concretely typed (the `BsonValue` tagged union), and the wire
framing is a state machine over a fixed set of message types.

## Pool-friendly shape, no pool in v1

Same pattern as `@cutils/postgres`:

1. **`MongoClient.connect()` returns one client; users own it.**
2. **`MongoClient` is `export class` (not `sealed`/`abstract`); user
   can extend.**
3. **`MongoClient implements AsyncDisposable`; `[Symbol.asyncDispose]()`
   is the release primitive.** A user-side pool's `release(client)` is
   `await client[Symbol.asyncDispose]()`.
4. **No global connection state, no `MongoClient.current`, no module-
   level singleton.**
5. **No internal "is in use" lock.** The class doesn't track checkout
   state — that's the user's job. The internal single-flight write
   queue is per-client (correct anyway for the wire protocol).
6. **No pool-only methods on `MongoClient`.** Every method on
   `MongoClient` works on a single connection.

A user-side pool:

```ts
class Pool {
  private idle: MongoClient[] = [];
  private busy: Set<MongoClient> = new Set();   // OK in user-space
  constructor(private readonly opts: ConnectOpts, private readonly max: number) {}

  async acquire(): Promise<MongoClient> {
    const c = this.idle.pop();
    if (c !== undefined) { this.busy.add(c); return c; }
    if (this.busy.size + this.idle.length < this.max) {
      const fresh = await MongoClient.connect(this.opts);
      this.busy.add(fresh);
      return fresh;
    }
    return new Promise((resolve) => {
      this._waiters.push(() => {
        const d = this.idle.pop()!;
        this.busy.add(d);
        resolve(d);
      });
    });
  }

  async release(c: MongoClient): Promise<void> {
    this.busy.delete(c);
    this.idle.push(c);
    if (this._waiters.length > 0) this._waiters.shift()!();
  }
}
```

~50-100 LoC with no impedance. If the user later wants a shipped
pool, it moves to a separate `@cutils/mongo-pool` package; v2 ticket.

## Compat matrix (MongoDB Atlas / Cosmos / DocumentDB / FerretDB)

| Operation | Atlas 5.0+ | Cosmos 4.2/5.0 | DocumentDB 5.0 | FerretDB 2.7 |
| --- | --- | --- | --- | --- |
| `insertOne` / `insertMany` | OK | OK | OK | OK |
| `find` / `findOne` | OK | OK | OK | OK |
| `getMore` (cursor drain) | OK | OK | OK | OK |
| `updateOne` / `updateMany` | OK | OK | OK | OK |
| `findOneAndUpdate` / `findOneAndDelete` | OK | OK | OK | OK |
| `deleteOne` / `deleteMany` | OK | OK | OK | OK |
| `countDocuments` / `estimatedDocumentCount` | OK | OK | OK | OK |
| `distinct` | OK | OK | OK | OK |
| `aggregate` (basic pipeline) | OK | OK | OK | OK |
| `bulkWrite` | OK | OK | OK | **NO** (server error) |
| Multi-doc transactions | OK (4.0+) | single unsharded collection only | OK (4.0+) | **NO** |
| `$lookup` (basic) | OK | partial | OK | OK |
| `$graphLookup` | OK | **NO** | **NO** | **NO** |
| Change streams (`watch()`) | OK | OK | OK (4.0+) | **NO** |
| Client-side field-level encryption | OK | **NO** (Cosmos has its own) | OK (5.0) | **NO** |
| Atlas Search indexes | OK | **NO** | **NO** | **NO** |
| `$function` / server-side JS | OK (deprecated) | **NO** | **NO** | **NO** |

### Implications for v1

- **CRUD: works everywhere.** Every method on `Collection<TDoc>` for
  read/write works on all four targets.
- **`bulkWrite`: ship, document.** On FerretDB it errors server-side
  with a clear message. The user gets a `MongoError` and can route
  around it.
- **Transactions: ship, document caveats.** Atlas + DocumentDB support
  full multi-collection. Cosmos supports single unsharded collection.
  FerretDB doesn't implement them. We ship `startTransaction()` and
  document the partial support.
- **Change streams / Atlas Search / CSFLE / `$graphLookup` / server-
  side JS: dropped for v1.** Each is subset-hostile (the first two)
  or unsupported on at least one target (all five). Shipping them
  would break the compat claim.
- **`$lookup` ships, we don't validate the pipeline.** The pipeline
  array is opaque to us. We ship it verbatim to the server. The user
  writes a pipeline valid for their target.
- **`$function`, `$accumulator`, server-side JS: dropped.** All four
  targets warn or refuse; subset-hostile in user code anyway.

## File layout

```
packages/mongo/
├── AGENTS.md              # subset bans + BSON subset + compat matrix
├── README.md              # usage, BSON classes, compat matrix, subset quirks
├── CHANGELOG.md
├── package.json           # name: @cutils/mongo; exports map; build scripts
├── tsconfig.json          # subset-strict
├── src/
│   ├── index.ts           # public surface
│   ├── types.ts           # Document, WithId, WithoutId, BsonPrimitive
│   ├── errors.ts          # MongoError class
│   ├── validate.ts        # Standard-Schema seam: withSchema(schema)
│   │                      # validates via schema["~standard"].validate
│   │                      # in findOne/find/insertOne/insertMany;
│   │                      # WithoutId<T> for lenient insert
│   ├── bson/
│   │   ├── objectid.ts    # class ObjectId (~60 LoC)
│   │   ├── binary.ts      # class Binary (~30 LoC)
│   │   └── value.ts       # BsonValue tagged union
│   └── internal/
│       ├── socket.ts      # node:net wrapper; single-flight writes
│       ├── tls.ts         # node:tls upgrade on STARTTLS
│       ├── auth.ts        # SCRAM-SHA-1/256 client implementation
│       ├── opmsg.ts       # OP_MSG encoder/decoder
│       ├── bson.ts        # BSON parser/serializer (11 types)
│       ├── commands.ts    # wire-level command shapes
│       ├── cursor.ts      # FindCursor + AggregateCursor (no generator)
│       ├── session.ts     # internal Session for transactions
│       ├── transaction.ts # Transaction + commit/rollback/savepoint
│       ├── reconnect.ts   # SDAM-stub: single host, single connection
│       └── buffer.ts      # reusable scratch buffer for read-ahead
├── test/
│   ├── bson.test.ts       # BSON round-trip for all 11 types
│   ├── cursor.test.ts     # Cursor surface (next/all/forEach)
│   ├── auth.test.ts       # RFC 5802 canonical SCRAM vectors
│   ├── mongo.test.ts      # integration tests against real MongoDB
│   ├── coverage.test.mjs  # scriptc coverage 100% gate
│   ├── parity.test.ts     # parity test against official mongodb driver
│   └── elf.test.sh        # end-to-end ELF smoke
├── examples/
│   └── todo-app-mongo/
│       ├── main.ts        # chttp + @cutils/mongo todo API
│       └── README.md
└── docs/
    ├── integration.md     # how to wire into a chttp app
    ├── schema.md          # Standard-Schema integration deep-dive
    ├── bson.md            # BSON classes + subset mapping
    ├── compat.md          # MongoDB / Cosmos / DocumentDB / FerretDB matrix
    └── subset-quirks.md   # findOne null, no for-await, no Pool
```

## Dependencies

- `mongodb` is **not** a dependency. The official driver has too many
  subset violations; patch cost equals hand-roll cost. Vendor
  references (source on GitHub) for behavior parity, not code.
- `mongoose` is **not** a dependency. Closure form, decorators,
  `Map`/`Set` everywhere; would not survive `scriptc coverage`.
- `bson` is **not** a dependency. Same subset violations; the wire-
  level BSON subset is hand-rolled.
- Zero runtime dependencies. `@standard-schema/spec` is a **type-only
  import** (types erase at compile, not a runtime dep); the runtime
  seam is `schema["~standard"].validate(doc)` on whatever validator
  the user hands in. The wrapper IS the generic Standard Schema v1
  adapter, which is why no validator package is a dependency.
- Dev: `@chttp/val` + `valibot` (seam-proof tests run BOTH).
- `testcontainers` is **dev-only** for integration tests, or we use
  raw `docker run --rm` in CI.
- `koffi` and other FFI helpers are **not** needed — this package is
  FFI-free.

## Testing strategy

1. **BSON round-trip tests** (`test/bson.test.ts`) — for all 11 BSON
   types we ship, verify the parser/serializer round-trips correctly.
   Catch-22 cross-checks against the official `bson` package in the
   Node test runner (where `bson` is `devDependencies`).
2. **Cursor surface tests** (`test/cursor.test.ts`) — verify
   `next() / tryNext() / hasNext() / all() / forEach(cb) / close()`.
   No `for await ... of` (subset-fenced).
3. **Auth tests** (`test/auth.test.ts`) — RFC 5802 canonical SCRAM-
   SHA-1/256 vectors. Cross-check against
   `PerryTS/postgres/src/auth/scram.ts` for parity.
4. **Integration tests** (`test/mongo.test.ts`) — against real MongoDB
   container (mongo:7); insert, find, update, delete, findOneAndUpdate,
   countDocuments, distinct, bulkWrite, aggregate, transaction (Atlas
   only in CI; DocumentDB + Cosmos + FerretDB documented but not in
   the default matrix). Validation fixtures run through BOTH
   validators (`@chttp/val` + `valibot` dev deps) to prove the seam.
5. **Parity tests** (`test/parity.test.ts`) — same test suite against
   the official `mongodb` driver, same MongoDB, same results. Catches
   wire-protocol behavior drift.
6. **Subset gate** (`test/coverage.test.mjs`) — `scriptc coverage` 100%
   on the wrapper source.
7. **End-to-end smoke** (`test/elf.test.sh`) — `scriptc build` a small
   program that connects, inserts, queries, prints. Catches ABI
   mismatches and FFI wiring bugs (we have no FFI, but the scriptc
   `node:*` lowerings need verification).

Test baselining per global rule 9c: full suite →
`/tmp/cutils-mongo-baseline-<ts>.log` before iterating, diff before
done.

## Scope discipline

- **Do not** add a `Pool` class in v1. The v1 shape is single-
  `MongoClient`-per-process and is pool-friendly by construction.
  A future v2 `@cutils/mongo-pool` may add a shipped pool; that is
  *deliberately* a separate package so the v1 surface stays small
  and the pool can pick its own semantics.
- **Do not** add a query builder or schema DSL. `Collection<TDoc>` is
  the typed surface; the user writes the filter as a plain TS record.
- **Do not** add change streams, Atlas Search, CSFLE, GridFS, or
  replica-set server selection in v1. Each is a v2 ticket with its
  own subset / compat / size trade-offs.
- **Do not** ship the official `mongodb` driver or `bson` package as a
  dependency. Hand-roll the wire layer.
- **Do not** ship `mongo.schema<UserDoc>()` (the typegoose-style
  optional sugar). The `Collection<TDoc>` generic is sufficient;
  extending the API to sugar is a v2 ticket if asked.
- **Do not** widen the public surface beyond the ~30 methods above
  (plus the BSON classes). New method = new test + new docs + new
  subset-coverage gate.
- **Do not** add async generator iteration on cursors. `function*` is
  subset-fenced. `next()` / `all()` / `forEach(cb)` cover the use
  cases.

## Bench cell (required before any perf claim)

`bench/cells/db-mongo-elf.yml` — measures `insertOne` and `findOne`
throughput on `@cutils/mongo` against the official `mongodb` driver
under Node 24, against a local MongoDB container. Required before any
performance claim lands in the README. NOT part of the v1 release;
v1 ships without any perf claim.

A second cell, `bench/cells/db-mongo-elf-schema.yml`, measures the
`withSchema(schema)` validation cost against no-schema collections.
Same gate.

## Risk register

- **Subset regressions in the wrapper.** Mitigation: `scriptc
  coverage` in CI, 100% gate. Same gate as `@cutils/sqlite`,
  `@cutils/postgres`.
- **BSON parser bugs.** Mitigation: round-trip tests against the
  official `bson` package in `devDependencies` (only used in the
  test runner, never in the compiled ELF); canonical test vectors
  for every type.
- **SCRAM-SHA-1/256 implementation bugs.** Mitigation: RFC 5802
  canonical test vectors; cross-check against
  `PerryTS/postgres/src/auth/scram.ts`; manual review.
- **Wire-protocol version drift.** Mitigation: pin the minimum
  supported MongoDB to 4.4 (Cosmos/DocumentDB/FerretDB all support
  4.4+; OP_MSG is the only protocol since 3.6); integration tests
  run against `mongo:4.4`, `mongo:5.0`, `mongo:7.0` matrix.
- **The `findOne` null-not-undefined return is a subset-clean win
  but a mental-model break for users coming from Mongoose** (which
  uses `null`). Mitigation: documented in `docs/subset-quirks.md`;
  matches the subset rule across all `@cutils/*` DBs.
- **Async dispose ordering with `await using` in loops.** scriptc
  0.3.3 supports `await using` in `for` loops; the wrap is
  deterministic (last-in-first-out). The same caveat as
  `@cutils/postgres` applies — nested `await using tx = ...` auto-
  saves, `Transaction[Symbol.asyncDispose]()` is the right place.
- **Hand-rolled driver + BSON parser become a maintenance burden.**
  Mitigation: the parser is small enough that one human understands
  it; the BSON spec is documented and stable; the wire protocol is
  documented; the `parity.test.ts` against the official driver is
  the regression net.
- **Compat-target drift (Cosmos / DocumentDB / FerretDB roll out
  new features that look supported but break in edge cases).**
  Mitigation: the `compat.md` doc lists the v1 surface per target;
  CI runs integration tests against at least one of
  Cosmos/DocumentDB/FerretDB if the user can provide credentials
  (Atlas for the default matrix).
- **Standard Schema spec drift; val coarse `InferOutput` until the
  type-brand ticket (T0b).** Mitigation: pin `@chttp/val` to a semver
  range; `schema["~standard"].validate` is the stable seam, and we do
  NOT use val's `_run`/`_safeRun` internals. Coarse typed output is
  compile-time only; runtime unaffected.

## Cross-cutting (ripples to other `@cutils/*` packages)

- **`@cutils/sqlite`, `@cutils/postgres`, `@cutils/mongo`** are
  three points on the same Standard-Schema-seam skeleton: one schema
  at construction/prepare time, one schema for read+write, lenient
  insert (`Partial<T>` for sql, `WithoutId<T>` for mongo), `*Raw`
  opt-out (sql + pg) or no-schema construction (mongo). Same
  monkeypatch-free discipline, same `using`/`await using`
  ergonomics, same pool-friendly-by-construction shape.
- None gated on the val type-brand ticket (T0b is val-side now);
  typed output flows through the Standard-Schema `InferOutput` alias.
- The v2 `@cutils/mongo-pool` and `@cutils/postgres-pool` are
  separate packages, single ticket per family. They share the
  `Database`/`MongoClient` pool-friendly surface; the pool
  semantics (FIFO vs LIFO, health checks, reconnection) are
  per-family decisions.

## Task breakdown (T-numbers for the project board)

### T0 — Plan, ticket, project wiring (S, infra)
- [ ] Create GitHub issue "Ship @cutils/mongo v0.1.0" with refined
      fields (iteration: 2026-Q4, effort: L, classification: feature).
- [ ] Link from `.agents/decisions.md` once shipped.

### T0b — val type-brand ticket (S, val package; NOT a blocker here)
- [ ] val-side work (the old `@cutils/sqlite` T0b): land the `_t!: T`
      declared fields on each `VSchema` subclass and update
      `InferOutput<S>` in `packages/val/src/schemas.ts`. Until it
      lands, @chttp/val `InferOutput` reached through the seam stays
      coarse; this package's runtime and tests are unaffected.

### T1 — BSON parser/serializer + classes (L, infra, the bulk of v1)
- [ ] `src/bson/objectid.ts` — class ObjectId (~60 LoC).
- [ ] `src/bson/binary.ts` — class Binary (~30 LoC).
- [ ] `src/bson/value.ts` — BsonValue tagged union.
- [ ] `src/internal/bson.ts` — parser/serializer for 11 BSON types.
- [ ] `test/bson.test.ts` — round-trip tests, cross-checked against
      official `bson` in devDependencies.

### T2 — OP_MSG wire encoder/decoder (M, infra)
- [ ] `src/internal/opmsg.ts` — OP_MSG header + section kind 0/1.
- [ ] `src/internal/commands.ts` — wire-level command shapes
      (`hello`, `ismaster`, `saslStart`, `saslContinue`, `buildInfo`,
      `getMore`, `killCursors`, `insert`, `find`, `update`, `delete`,
      `aggregate`, `commitTransaction`, `abortTransaction`).
- [ ] `test/opmsg.test.ts` — MockSocket-driven unit tests.

### T3 — Connection + TLS + Startup (M, infra)
- [ ] `src/internal/socket.ts` — single-flight writes over `node:net`.
- [ ] `src/internal/tls.ts` — `node:tls` upgrade on STARTTLS.
- [ ] `src/internal/connect.ts` — `hello` + `buildInfo` + first
      `getMore`; populate `client.uri`, `client.dbName`.
- [ ] Integration test: connect, run `db.runCommand({ ping: 1 })`,
      close.

### T4 — SCRAM-SHA-1/256 auth (M, infra)
- [ ] `src/internal/auth.ts` — SCRAM-SHA-1/256 client.
- [ ] RFC 5802 canonical test vectors in `test/auth.test.ts`.
- [ ] Cross-check against `PerryTS/postgres/src/auth/scram.ts`.
- [ ] Integration test: connect with `uri` (user:pass), run
      `db.runCommand({ ping: 1 })`.

### T5 — Cursor surface (S, feature)
- [ ] `src/internal/cursor.ts` — `FindCursor<TDoc>` and
      `AggregateCursor<TOut>` with the six-method surface.
- [ ] `test/cursor.test.ts` — verify `next() / tryNext() / hasNext() /
      all() / forEach(cb) / close()`. No `for await ... of`.

### T6 — Collection CRUD (L, feature, the bulk of v1)
- [ ] `src/index.ts` — `Collection<TDoc>` class with all ~20
      methods above.
- [ ] `src/validate.ts` — Standard-Schema seam: `withSchema(schema)`
      validates via `schema["~standard"].validate` and re-projects
      the collection's `TDoc` to `WithId<InferOutput<Schema>>` (via
      the local alias); `insertOne`/`insertMany` validate the
      wire-encoded input; `findOne`/`find` validate the wire-decoded
      output (BSON classes unwrapped to plain TS). One schema covers
      both. `WithoutId<TDoc>` for lenient insert.
- [ ] Integration tests: insertOne/insertMany, findOne/find,
      updateOne/updateMany, deleteOne/deleteMany, findOneAndUpdate,
      findOneAndDelete, countDocuments, distinct, bulkWrite, aggregate.

### T7 — Transaction + auto-savepoint (S, feature)
- [ ] `Transaction` class with `[Symbol.asyncDispose]()` doing
      auto-commit/rollback + auto-savepoint on nested.
- [ ] `src/internal/session.ts` — internal `Session` for the OP_MSG
      `lsid` field.
- [ ] Integration test: nested transaction → savepoint; rollback in
      inner → abort; outer commits.

### T8 — Errors + BSON classes (S, infra)
- [ ] `src/errors.ts` — `MongoError` class with code/codeName/message.
- [ ] `src/bson/objectid.ts`, `src/bson/binary.ts` — wrapper classes.

### T9 — Tests + example + docs (M, feature, infra)
- [ ] `test/parity.test.ts` — same test suite, both drivers, same
      MongoDB, same results.
- [ ] `test/elf.test.sh` — end-to-end ELF smoke.
- [ ] `test/coverage.test.mjs` — `scriptc coverage` 100% gate.
- [ ] `examples/todo-app-mongo/main.ts` — chttp + cutils/mongo todo
      API, ~80 LoC, with a schema for the User document.
- [ ] `docs/integration.md`, `docs/schema.md`, `docs/bson.md`,
      `docs/compat.md`, `docs/subset-quirks.md`.
- [ ] `README.md` with copy-pasteable snippets, BSON class table,
      compat matrix, and a "mongoose users: what changed" section.

### T10 — Release (S, infra)
- [ ] `pnpm change` intent file.
- [ ] Bump via `pnpm version -r`; tag `v<version>`; release
      workflow publishes.

### T11 — Follow-ups (NOT in v1, tracked as separate tickets)
- [ ] Bench cell `bench/cells/db-mongo-elf.yml`.
- [ ] Bench cell `bench/cells/db-mongo-elf-schema.yml` — measures
      validation cost of `withSchema(schema)` against no-schema
      collections.
- [ ] `@cutils/mongo-pool` (or `@cutils/pool-mongo`) — separate
      package; ships a `Pool` class. The v1 `MongoClient` shape is
      pool-friendly by construction — this follow-up is a *shipped*
      pool, not a v1 commitment.
- [ ] Change streams (`watch()`) — v2; gated on a `function*`/async-
      generator subset loosening, which is unlikely.
- [ ] Replica-set server selection (SDAM) — v2; ~3,000 LoC of
      topology code.
- [ ] Atlas Search indexes — v2; Atlas-only.
- [ ] Client-side field-level encryption — v2; Atlas-only.
- [ ] GridFS — v2; large-file BSON stream protocol.
- [ ] BSON `Long` (class with arithmetic) — v2 if asked; subset-
      clean `bigint`-backed class is feasible but adds ~500 LoC.
- [ ] BSON `Decimal128` — v2 if asked; IEEE 754-2008 quad is ~800
      LoC for one type.
- [ ] `@cutils/drizzle-mongo` — separate package; maps a hypothetical
      Drizzle MongoDB DSL to our `Collection<TDoc>` (gated on Drizzle
      actually shipping MongoDB; today it does not).
- [ ] Generic Standard Schema v1 adapter — inverted into the design,
      not a follow-up: `validate.ts` already validates through the
      seam (`schema["~standard"].validate`), so any conforming
      validator plugs in without a wrapper change.

## References

- MongoDB wire spec: <https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/>.
- MongoDB BSON spec: <https://bsonspec.org/> and
  `https://github.com/mongodb/js-bson`.
- SCRAM-SHA-1/256 RFC 5802: <https://datatracker.ietf.org/doc/html/rfc5802>.
- CosmosDB for MongoDB compat: <https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-50>.
- DocumentDB compat: <https://docs.aws.amazon.com/documentdb/latest/developerguide/mongo-apis.html>.
- FerretDB compat: <https://docs.ferretdb.io/migration/compatibility/>.
- `mongodb` driver source (parity reference): `https://github.com/mongodb/node-mongodb-native`.
- `mongoose` source (model/lean reference): `https://github.com/Automattic/mongoose`.
- `@cutils/sqlite` (the design template):
  `.agents/plans/2026-10-15-cutils-sqlite.md`.
- `@cutils/postgres` (the async template):
  `.agents/plans/2026-10-15-cutils-postgres.md`.
- Mongo design analysis: `/tmp/cutils-mongo-design-analysis.md`.
- `memory:cutils_db_val_first.md` — DB-family schema design rules
  for the whole `@cutils/*` DB family.
- `memory:scriptc_using_audit.md` — confirms `using` and `await using`
  compile in 0.3.3.
- `packages/val/src/types.ts:47-65` — Standard Schema v1 conformance
  baseline (val's `~standard` interface, used as the integration seam).
