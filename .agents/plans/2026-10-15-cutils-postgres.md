# @cutils/postgres — async hand-rolled wire driver, 2026-10-15

## What this is

Hand-rolled, async, TCP+TLS Postgres wire-protocol driver for chttp apps,
shipped as a TypeScript package that compiles to a single static binary
with `scriptc build`. Same public skeleton as `@cutils/sqlite` (the
better-sqlite3 + drizzle-orm inspired shape), but async on the
`[Symbol.asyncDispose]()` side and hand-rolled against the Postgres wire
spec instead of vendoring a C library. No `pg`, no `postgres.js`, no
`pg-native` — just `node:net` + `node:tls` + `node:crypto` from the
scriptc 0.3.3 lowered surface.

Same Standard-Schema seam as `@cutils/sqlite`: the user writes ONE
Standard-Schema validator schema (`@chttp/val`, valibot, or any
conforming lib), hands it to `await db.prepare(sql, schema)`, and
`InferOutput<typeof schema>` is the row type. Same schema is used
for select AND insert (insert is lenient via `Partial<T>`);
validation runs on read AND write; a `*Raw` family opts out for
hot paths. See `.agents/memory/cutils_db_val_first.md` for the full
design rules. No upstream val change required: typing flows through
the Standard-Schema spec (`InferOutput` over `StandardSchemaV1`).

## Why second

- **Highest value per LoC after SQLite.** The wire protocol is
  ~1,500-2,500 LoC of subset-clean TypeScript. SQLite is v1 because
  embedded beats hosted; Postgres is v2 because the *most common chttp
  app talks to a managed Postgres* (Neon, Supabase, RDS). Without this
  package, every chttp user that wants Postgres pays a 3,000-LoC vendor
  cost or rolls their own.
- **Validates the design rules end to end.** If `@cutils/sqlite` is the
  better-sqlite3 + drizzle design, `@cutils/postgres` is the test: do
  the same rules (generic `TRow`, schema at `prepare` time, `using
  tx` auto-savepoint, one `prepare()` signature with overloaded
  `get/all/run`, no monkeypatching) work for an async wire protocol?
  If yes, `@cutils/mongo` is the same skeleton on a different
  transport.
- **Hand-rolled, not vendored.** PerryTS/postgres (MIT, 5,445 LoC, AOT
  on Perry) is the closest precedent, but it has ~15 subset violations
  in our subset (Map, Set, new Function, class-field initializers,
  `|undefined` unions). Patch cost equals hand-roll cost — the user
  decided this. Plus: subset-clean TS is faster to read and the surface
  we ship is narrower than Perry's.
- **No FFI.** The whole stack is `node:net` + `node:tls` + `node:crypto`
  + TypeScript. No amalgamation, no `cc`, no `ar rcs`, no manifest. The
  build pipeline is `tsc` and nothing else. This is the second
  "category-creating" package (first was SQLite) — TS-only Postgres
  driver that compiles to a static ELF.
- **Pool-friendly without shipping a pool.** v1 is one
  `Database` per process (the 80% chttp + Neon/Supabase use case).
  The class shape is designed so a user can implement their own
  pool in user-space — `connect()` returns a single connection that
  the user can hold/release; the `await using` primitive is exactly
  what a user-side pool would call. We deliberately *do not* ship a
  `Pool` class in v1 (see "Pool-friendly shape, no pool in v1" below).

## Non-goals

- A connection pool. **v1 ships no `Pool` class.** v1 is a single
  `Database` per process — the 80% chttp + Neon/Supabase use case.
  Pool is *deliberately* not in v1 for three reasons: (a) the single-
  connection shape is correct for the typical managed-Postgres
  workload; (b) every pool implementation wants different semantics
  (per-key, FIFO, LIFO, per-transaction, per-request, with
  reconnection, with health checks) and shipping a pool means picking
  one; (c) the `Database` shape is pool-friendly out of the box —
  user-space pools are ~50-100 LoC on top of the public surface. See
  "Pool-friendly shape, no pool in v1" below.
- An ORM, query builder, or migration tool. The same separation as
  `@cutils/sqlite` — surface is wire + types, not a DSL. A separate
  `@cutils/drizzle-postgres` may be built on top later.
- Pipeline mode, COPY FROM/TO, LISTEN/NOTIFY, advisory locks, prepared-
  statement server-side caching beyond what the wire spec requires for
  correctness. Each is a v2 ticket if asked.
- pgwire-level extensions (Citus, TimescaleDB, Supabase Realtime). Out
  of scope. The driver speaks the documented Postgres 7.4+ wire
  protocol; extensions are user concerns.
- Replication, logical decoding, hot standby. Out of scope.
- Vendor PerryTS/postgres. Hand-roll is the user-locked decision.

## Pool-friendly shape, no pool in v1

The driver is designed so a user can implement their own pool in
~50-100 LoC of user-space TypeScript, on top of the v1 public surface
without any impedance or `as` casts. The design rules:

1. **`Database.connect()` returns one connection; users own it.**
   The returned `Database` is a single TCP+TLS socket wrapped in
   a class. Holding the result is the user's job.
2. **`Database` is a non-sealed, non-final class with no hidden
   state.** All connection state lives in private fields the user
   doesn't see, but the class is `export class Database` (not
   `abstract` or `sealed`), so a user can `extends` it or
   compose it.
3. **`Database` implements `AsyncDisposable`.** The
   `[Symbol.asyncDispose]()` method is part of the public contract
   — a user-side pool's `release(db)` is `await db[Symbol.asyncDispose]()`.
4. **No global connection state.** A `Database` is bound to a single
   socket by `connect()`. There is no `setDefaultDatabase(db)`,
   no module-level connection, no `Database.current` singleton.
5. **No internal "is in use" lock.** The class doesn't track whether
   the connection is "checked out" — that's the user's job. The
   v1 driver's only locking is the single-flight write queue inside
   `socket.ts` (one in-flight query at a time, which is correct
   for the Postgres wire protocol anyway).
6. **No pool-only methods on `Database`.** Every method on
   `Database` works on a single connection. There is no
   `db.acquireFromPool()`, no `db.isFromPool`, no
   `db.invalidate()` (a user-side pool calls `close()` and opens a
   new connection; the driver doesn't need to know).

A user-side pool shape that lands on this:

```ts
// user-space, no @cutils/* import beyond Database + Stmt + Transaction
class Pool {
  private idle: Database[] = [];
  private busy: Set<Database> = new Set();   // OK in user-space: no subset rules there
  constructor(private readonly opts: ConnectOpts, private readonly max: number) {}

  async acquire(): Promise<Database> {
    const db = this.idle.pop();
    if (db !== undefined) { this.busy.add(db); return db; }
    if (this.busy.size + this.idle.length < this.max) {
      const fresh = await Database.connect(this.opts);
      this.busy.add(fresh);
      return fresh;
    }
    // backpressure: wait for a release
    return new Promise((resolve) => {
      this._waiters.push(() => {
        const d = this.idle.pop()!;
        this.busy.add(d);
        resolve(d);
      });
    });
  }

  async release(db: Database): Promise<void> {
    this.busy.delete(db);
    this.idle.push(db);
    if (this._waiters.length > 0) this._waiters.shift()!();
  }

  // user can layer health checks, reconnection, key-based routing, etc.
}
```

A `~50-100` LoC pool with no impedance. If the user later wants a
shipped pool, it moves to a separate `@cutils/postgres-pool` package
(or `@cutils/pool-postgres`); that's a v2 ticket, not a v1 commitment.

What the user *cannot* reasonably build in user-space:

- **Statement cache** (server-side prepared statements, LRU-keyed by
  SQL text). v1 keeps the wrapper's `_stmts: Stmt[]` array per
  `Database`; a user-side cache would need to know the wrapper's
  internals. We *do* expose `stmt.toString()` for cache keys, but the
  cache itself is the wrapper's job.
- **Single-flight writes** across multiple `Database` instances. The
  v1 driver guarantees single-flight writes *per `Database`*. A user
  pool of 10 connections has 10 independent in-flight queries, which
  is what a pool wants anyway.
- **CancelRequest forwarding** across pool boundaries. A user pool
  forwarding `cancel(stmt)` to the right connection is straightforward
  (the `Stmt` carries a back-reference to its `Database`), but
  the `backendSecret` lives on `Database`, not `Stmt`. If a `Pool`
  ships later, it lives in the same package as the cancel logic.

The pool-shaped v2 ticket:

> v2 `Pool` (separate package) — picks ONE pool semantics (probably
> FIFO with health checks and reconnection), lives at
> `@cutils/postgres-pool` or similar, depends on `@cutils/postgres`.
> NOT in v1 of `@cutils/postgres`.

## Public surface (same skeleton as `@cutils/sqlite`, async)

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Socket } from "node:net";

// Type-only alias over the spec; erases at compile, not a runtime dep.
type InferOutput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
import { Database, Stmt, Transaction, PgError } from "@cutils/postgres";

export type SqlValue = number | bigint | string | boolean | Date | null | Uint8Array;
export type BindValue = SqlValue;
export type Row = Record<string, SqlValue>;
export interface RunResult { rowCount: number; }
export interface ConnectOpts {
  host: string;
  port?: number;                  // default 5432
  user: string;
  password: string;
  database: string;               // database name, NOT the connection target
  ssl?: "disable" | "require" | "verify-full";
  applicationName?: string;
  connectTimeoutMs?: number;      // default 10000
  statementTimeoutMs?: number;    // default 0 (no timeout)
}

export class PgError extends Error {
  code: string;                   // SQLSTATE 5-char code: 23505 (unique violation), etc.
  severity: string;               // ERROR, FATAL, PANIC
  detail: string | null;
  hint: string | null;
  position: number | null;        // 1-based char position in the query
  constructor(fields: { code: string; message: string; severity: string; detail: string | null; hint: string | null; position: number | null });
}

export class Database implements AsyncDisposable {
  static async connect(opts: ConnectOpts): Promise<Database>;

  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly backendPid: number;    // populated after StartupMessage
  readonly backendSecret: string; // populated after StartupMessage; for cancel requests
  readonly inTransaction: boolean;

  // Validation runs by default; *Raw opts out for hot paths.
  exec(sql: string): Promise<void>;
  execRaw(sql: string): Promise<void>;
  pragma(sql: string): Promise<{ rows: Row[] }>;  // see "SHOW / SET support" below
  transaction(): Promise<Transaction>;

  // prepare() — schema attached at prepare time, NOT chained.
  // TRow = InferOutput<schema> (read). Validation runs on get/all
  // (read) and run (write; lenient via Partial<TRow>).
  // The Stmt overloads run/get/all for both bind shapes (anonymous
  // tuple vs named record) — caller's arg type picks the overload.
  prepare<Schema extends StandardSchemaV1>(sql: string, schema: Schema):
    Promise<Stmt<InferOutput<Schema>>>;
  // prepareRaw — untyped escape hatch. No schema, no validation.
  prepareRaw(sql: string): Promise<Stmt<unknown>>;

  lastInsertRowid(): Promise<bigint>;  // Postgres has no rowid; throws
  changes(): Promise<number>;          // returns 0; throws on use
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

// TRow = InferOutput<schema> (read) or unknown (prepareRaw).
// Insert validates against the schema (lenient: Partial<TRow>).
// The Stmt overloads run/get/all for both bind shapes.
export class Stmt<TRow = unknown> implements AsyncDisposable {
  readonly source: string;
  readonly reader: boolean;       // returns rows
  readonly readonly: boolean;     // no DML
  readonly database: Database;
  readonly schema: StandardSchemaV1 | null; // null on prepareRaw

  // Validated paths (overloaded for both bind shapes).
  run(params: BindValue[]): Promise<RunResult>;
  run(params: Record<string, BindValue>): Promise<RunResult>;
  get(params: BindValue[]): Promise<TRow | undefined>; // see "Known divergence"
  get(params: Record<string, BindValue>): Promise<TRow | undefined>;
  getOrNull(params: BindValue[]): Promise<TRow | null>;  // subset-strict variant
  getOrNull(params: Record<string, BindValue>): Promise<TRow | null>;
  all(params: BindValue[]): Promise<TRow[]>;
  all(params: Record<string, BindValue>): Promise<TRow[]>;
  bind(params: BindValue[]): this;                       // permanent bind
  bind(params: Record<string, BindValue>): this;

  // Raw paths — no validation, untyped return.
  runRaw(params: BindValue[]): Promise<RunResult>;
  runRaw(params: Record<string, BindValue>): Promise<RunResult>;
  getRaw(params: BindValue[]): Promise<unknown>;
  getRaw(params: Record<string, BindValue>): Promise<unknown>;
  allRaw(params: BindValue[]): Promise<unknown[]>;
  allRaw(params: Record<string, BindValue>): Promise<unknown[]>;

  columns(): Array<{
    name: string; column: string | null; table: string | null;
    schema: string | null; database: string | null; type: string | null;
    notNull: boolean; default: string | null;
  }>;

  // Postgres extended: server-side prepared statements are explicitly
  // closed via DEALLOCATE; the wrapper does it on dispose().
  finalize(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export class Transaction implements AsyncDisposable {
  readonly database: Database;
  exec(sql: string): Promise<void>;
  execRaw(sql: string): Promise<void>;
  // Transaction-scoped prepare() — same seam shape as Database.prepare.
  prepare<Schema extends StandardSchemaV1>(sql: string, schema: Schema):
    Promise<Stmt<InferOutput<Schema>>>;
  prepareRaw(sql: string): Promise<Stmt<unknown>>;
  savepoint(name: string): Promise<Transaction>;     // explicit savepoint
  commit(): Promise<void>;                           // auto on clean dispose
  rollback(): Promise<void>;                         // auto on dispose-after-throw
  [Symbol.asyncDispose](): Promise<void>;
}
```

### Same skeleton, async, key changes from `@cutils/sqlite`

1. **All methods are async.** `Database` and `Stmt` and `Transaction`
   all `implements AsyncDisposable` with `[Symbol.asyncDispose]()`.
2. **BindValue widens to `Date` and `boolean`.** Postgres `timestamp`
   binds/round-trips as `Date` (we map to/from `node:crypto`-style
   ISO-8601 microsecond strings on the wire, with `Date` objects in
   the user-facing API). `boolean` is real (not 0/1).
3. **No `lastInsertRowid` / `changes`.** Postgres has no rowid
   semantics; calling these throws `PgError("0A000", "not supported:
   Postgres has no rowid", ...)`. Documented in the README.
4. **`columns()` has Postgres-specific metadata** (schema name, NOT
   NULL flag, default expression).
5. **Transaction acquire is async.** `using tx = await db.transaction()`.
   The dispose hook is async; the user's code stays block-scoped via
   `await using` (scriptc 0.3.3 supports this with zero-arg
   `[Symbol.asyncDispose]()`).
6. **Auto-savepoint on nested `await using tx =`** is identical to the
   `@cutils/sqlite` design — `this._parent !== null` in
   `Transaction[Symbol.asyncDispose]()`.
7. **`get()` returns `undefined` on no-row** (better-sqlite3 parity,
   user-locked decision). `getOrNull(): TRow | null` for
   subset-clean callers. Documented in `docs/subset-quirks.md`.
8. **The schema is the row type, not a separate `TRow` generic.** The
   user writes `await db.prepare(sql, schema)` and `InferOutput<typeof
   schema>` is `TRow`. Same schema validates the read output (after
   `step()`) and the write input (before binding). `run` accepts
   `Partial<TRow>` (lenient insert). `*Raw` family bypasses both.
   Same shape as `@cutils/sqlite` — one design language across the
   whole DB family.

### Postgres-specific add-ons (small, in scope)

- `Database.execute(sql, args?)` — shortcut for the no-statement-cache
  simple-query path. Used for `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`,
  `SET`, `SHOW`, `RESET`, `LISTEN`, `NOTIFY`, etc. Skips the prepared-
  statement cache entirely.
- `Database.notify(channel, payload)` — `LISTEN`/`NOTIFY` shortcut.
  Returns `{ received: { channel: string; payload: string; pid: number }[] }`
  drained on the call (or empty if nothing was queued).
- `Database.cancel(stmt)` — sends a CancelRequest with the saved
  `backendPid` / `backendSecret`. Cancels a long-running query without
  closing the connection.
- `Database.serverVersion` — populated from the `ParameterStatus` stream
  after startup; useful for `pg_dump`-style version checks.

These are all on the `Database` class, not the `Stmt` class. None of
them are required for the 80% use case; they're the "10% that matters"
items that distinguish a real driver from a stub.

## One `prepare()` signature, overloaded `get/all/run` on `Stmt`

Same reasoning as `@cutils/sqlite`: one `prepare(sql, schema)` returns
`Stmt<InferOutput<Schema>>`; the bind shape (anonymous tuple vs named
record) is declared by the user's call-site arg type via TypeScript
overloads on `get`/`all`/`run`/`bind`. No second generic, no options
bag, no `withSchema` chain. The schema is the source of truth for the
row type; one schema for read AND write (insert is lenient via
`Partial<TRow>`); `*Raw` opts out for hot paths.

Validation is a `schema["~standard"].validate(row)` call at runtime.
The `~standard` property is declared-structural in the spec's types,
so the property access is subset-clean (no SC1090 fencing; same
note as `@cutils/csv`'s seam).

PerryTS/postgres's API surface maps to this shape via `sql.query(text,
values)` and `sql.query(text, params)` — their tuple/record dispatch
is exactly the same overload pattern, just without the schema
parameter.
essentially the same shape.

## Why hand-roll instead of vendor PerryTS/postgres

The previous research round (memory: `chttp_scriptc_subset_database_drivers/db-drivers-subset-research.md`)
reached this conclusion; the user-locked decision is "hand-roll." The
specifics:

- PerryTS/postgres is MIT, 5,445 LoC, single author (skelpo), targets
  the Perry compiler (not scriptc). It compiles end-to-end on Perry
  with the documented subset rules. Our subset is stricter (no
  `?.`/`??`, no `obj[variable]`, no class-field initializers, no
  `|undefined`).
- Measured subset violations in PerryTS/postgres:
  - 3× `Map` (one in `Connection` for state, one in `Pool` for
    per-connection metadata, one in the type registry)
  - 1× `Set` (listening channels)
  - 1× `new Function` (the optional SQL template-tag parser)
  - ~7× class-field initializers
  - ~5× `|undefined` unions
  - Map-based dispatch holding closures as record fields
- Patch cost: 500-700 LoC of pure-loss work — removing Perry-specific
  branches, rewriting Map → array. The diff would touch the auth path,
  the pool path, the type registry, and the connection state machine.
  After the patch, the file is no longer recognizably PerryTS/postgres
  and is harder to re-sync with upstream fixes.
- Hand-roll cost: ~1,500-2,500 LoC, but it is *our* code from day one
  and we own the design. The reference (the spec'd protocol,
  PerryTS/postgres, `pg-protocol` for the encoding helpers) is plenty
  for a single-author hand-roll.
- SCRAM-SHA-256 is the hardest part. PerryTS/postgres's
  `src/auth/scram.ts` is a clean reference — it's the part of Perry
  we'd learn from, not vendor.

## Wire protocol — what the hand-roll needs to implement

The Postgres wire protocol is documented in the upstream "Frontend/
Backend Protocol" chapter (PostgreSQL >= 7.4, stable since). The
~2,000 LoC breaks down roughly:

| Component | LoC | Notes |
| --- | --- | --- |
| Connection / TLS / Startup | 200-300 | `node:net` socket; `node:tls` upgrade on `SslRequest`; `StartupMessage` + `ParameterStatus` stream |
| SCRAM-SHA-256 auth | 250-350 | The hardest part. Reference: `PerryTS/postgres/src/auth/scram.ts`. Uses `node:crypto`'s `pbkdf2`, `createHmac`, `timingSafeEqual` — all subset-clean. |
| Simple Query (`Q` / `Execute` with no params) | 200-300 | Used for `BEGIN` / `COMMIT` / `SHOW` / `SET` / `LISTEN` |
| Extended Query (`Parse` / `Bind` / `Describe` / `Execute` / `Sync`) | 600-800 | The prepared-statement path. 5 message types; each is a small encoder/decoder. |
| Row DataDecoder | 200-300 | `DataRow` is a sequence of column values with explicit length prefixes; format codes 0/1 (text/binary) and the type's OID determine how to decode. |
| COPY IN/OUT | deferred v2 | Out of v1 scope. |
| LISTEN/NOTIFY | 100-150 | The async notifications stream. `Notify` messages are interleaved with query responses. |
| Error path (ErrorResponse) | 50-100 | Parse the 18-field error response; throw `PgError` with the relevant fields. |
| CancelRequest | 50 | Two int32s (pid + secret). `node:net` open-then-close; no auth. |
| ParameterStatus / NoticeResponse / NotificationResponse | 100-150 | Background-stream events; mostly parse-and-discard for v1. |

Total: ~1,800-2,500 LoC. Single-author, subset-clean.

## Source-of-truth references for the hand-roll

- **Postgres wire spec** — `https://www.postgresql.org/docs/current/protocol.html`
  (PostgreSQL >= 7.4; the 7.4 boundary is the "stable since" baseline
  the user-side drivers target).
- **`pg-protocol`** (Node PG's wire encoder/decoder, dep-free, single
  author) — `https://github.com/brianc/node-postgres/tree/master/packages/pg-protocol`.
  1,176 LoC, MIT, no dependencies. Use as the **shape reference** for
  the encoder/decoder classes; do not vendor (it has subset violations
  in `enum`s and `Object.create`-style V8 patterns).
- **PerryTS/postgres** — MIT, single author, 5,445 LoC, subset-clean on
  Perry. Use for: (a) SCRAM-SHA-256 reference, (b) extended-query
  message flow, (c) data-row decoder. Cite, do not vendor.
- **`porsager/postgres`** (postgres.js) — 2,694 LoC total, single
  index.js is 567 lines. Use as a *secondary* reference for the
  `simpleQuery` path's edge cases.
- **`libpq`** (Postgres's own C client) — source-of-truth for the
  message encodings when in doubt. Don't copy C; use it as the spec.

## Build pipeline — `package.json` scripts

No FFI. No `cc`, no `ar rcs`, no manifest generator. The build is
`tsc` and that's it.

```
"scripts": {
  "build:ts":  "tsc -p tsconfig.json",
  "build":     "pnpm build:ts"
}
```

CI gate: `scriptc coverage` on the wrapper source. 100% coverage
required, same gate as `@chttp/val`, `@chttp/router`, `@cutils/sqlite`.

## Testing strategy

1. **Unit tests against a `MockSocket`** (`test/wire.test.ts`) — a
   minimal `node:net.Socket` stub that captures writes and replays
   canned reads. Tests the message encoder/decoder in isolation. No
   real Postgres needed for ~70% of the test surface.
2. **Integration tests against a real Postgres** (`test/pg.test.ts`) —
   `docker run postgres:17-alpine` in CI, run the wrapper against it.
   Spins up via `testcontainers` (Node) or `docker run --rm` (CI).
   Covers: SCRAM auth, simple query, extended query, transactions,
   savepoints, parameter binding, type round-tripping, error path,
   schema validation through BOTH `@chttp/val` and valibot fixtures
   (seam-proof).
3. **Subset gate** (`test/coverage.test.mjs`) — `scriptc coverage` 100%.
4. **End-to-end smoke** (`test/elf.test.sh`) — `scriptc build` a small
   program that connects to a Postgres container, runs a query, prints
   the result. Run, assert output. Catches ABI mismatches and
   `node:net`/`node:tls`/`node:crypto` lowering bugs.
5. **Against PerryTS/postgres parity** — a parity test that runs the
   same test suite against both `@cutils/postgres` and PerryTS/postgres
   connected to the same Postgres, asserting the same row results.
   Catches any divergence in type coercion or error mapping.

Test baselining per global rule 9c: full suite →
`/tmp/cutils-postgres-baseline-<ts>.log` before iterating, diff before
done.

## File layout

```
packages/postgres/
├── AGENTS.md             # subset bans + node:net/tls/crypto rules + testing rules
├── README.md             # usage, examples, "subset quirks" section
├── CHANGELOG.md
├── package.json          # name: @cutils/postgres; exports map; build scripts
├── tsconfig.json         # subset-strict
├── src/
│   ├── index.ts          # public surface
│   ├── types.ts          # BindValue, SqlValue, Row, RunResult, ConnectOpts
│   ├── errors.ts         # PgError class, SQLSTATE mapping
│   ├── validate.ts       # Standard-Schema seam: prepare(sql, schema)
│   │                     # wires schema['~standard'].validate into
│   │                     # get/all/run; Partial<T> for lenient insert;
│   │                     # *Raw opt-out
│   └── internal/
│       ├── socket.ts     # node:net wrapper; single-flight writes
│       ├── tls.ts        # node:tls upgrade on SslRequest
│       ├── auth.ts       # SCRAM-SHA-256 client implementation
│       ├── messages.ts   # encoder/decoder for all wire messages
│       ├── simple.ts     # Simple Query path (Q/Execute)
│       ├── extended.ts   # Extended Query path (Parse/Bind/Describe/Execute/Sync)
│       ├── rows.ts       # DataRow decoder; type OID → SqlValue
│       ├── oids.ts       # Postgres type OID registry (subset of the common ones)
│       ├── cancel.ts     # CancelRequest
│       ├── notify.ts     # LISTEN/NOTIFY background stream
│       └── buffer.ts     # reusable scratch buffer for read-ahead
├── test/
│   ├── wire.test.ts      # MockSocket-driven unit tests
│   ├── pg.test.ts        # integration tests against real Postgres
│   ├── coverage.test.mjs # scriptc coverage 100% gate
│   ├── parity.test.ts    # parity test against PerryTS/postgres
│   └── elf.test.sh       # end-to-end ELF smoke
├── examples/
│   └── todo-app-postgres/
│       ├── main.ts       # chttp + @cutils/postgres todo API
│       └── README.md
└── docs/
    ├── integration.md
    ├── auth.md           # SCRAM-SHA-256 details
    ├── schema.md         # Standard-Schema deep-dive (val + valibot examples)
    └── subset-quirks.md  # get() / getOrNull, the |undefined surface
```

## Dependencies

- `pg` is **not** a dependency (and can't be — its `pg-native` is a
  Node addon; the pure-JS path uses `pg-protocol` which has subset
  violations).
- **Zero runtime dependencies.** Schema params type against
  `StandardSchemaV1` — a type-only import from
  `@standard-schema/spec`; types erase at compile.
- The Standard-Schema seam IS the contract: the runtime validator is
  `schema["~standard"].validate`, and `@chttp/val` and valibot both
  conform (valibot verified compiling under scriptc 0.3.3).
  `InferOutput` is a two-line local alias over the spec's
  `StandardSchemaV1.InferOutput`.
- `@chttp/val` and `valibot` are **dev dependencies** — the
  seam-proof tests run fixtures through BOTH validators.
- `testcontainers` is **dev-only** for integration tests, or we use
  raw `docker run --rm` in CI.
- `koffi` and other FFI helpers are **not** needed — this package is
  FFI-free.

## Scope discipline

- **Do not** add a `Pool` class in v1 of `@cutils/postgres`. The
  v1 shape is single-`Database`-per-process and is pool-friendly
  by construction (see "Pool-friendly shape, no pool in v1" above).
  A future v2 `@cutils/postgres-pool` (or `@cutils/pool-postgres`)
  may add a shipped pool; that is *deliberately* a separate
  package so the v1 surface stays small and the pool can pick
  its own semantics (FIFO vs LIFO, health checks, reconnection,
  per-key, etc.) without forcing a choice on every `@cutils/postgres`
  user.
- **Do not** add an ORM, query builder, or migration tool. A
  separate `@cutils/drizzle-postgres` may be built on top later.
- **Do not** add COPY IN/OUT in v1. The wire encoding is documented
  but the surface is large (binary copy mode, text copy mode, error
  handling mid-stream). v2 if asked.
- **Do not** add LISTEN/NOTIFY in v1 *as a primary surface*. The
  `Database.notify(channel, payload)` shortcut is in v1 because it's
  the simple-query path; a long-lived `LISTEN` consumer that
  multiplexes notifications with queries is v2.
- **Do not** vendor PerryTS/postgres. Hand-roll.
- **Do not** vendor `pg-protocol`. Use as a *reference* (shape of
  encoders/decoders), not as a dependency.
- **Do not** widen the public surface beyond the ~17 methods above
  (plus the 4 Postgres-specific add-ons). New method = new test +
  new docs + new subset-coverage gate. High cost to add speculatively.
- **Do not** lock pool-shaped users out of the public surface. A
  user-space pool is ~50-100 LoC on top of `Database.connect()`,
  `[Symbol.asyncDispose]()`, and the `prepare()/exec()` methods. If
  a future change makes this harder, the design rule was violated.

## Bench cell (required before any perf claim)

`bench/cells/db-pg-elf.yml` — measures `INSERT` and `SELECT` throughput
on `@cutils/postgres` against `pg` (Node PG) under Node 24, against a
local Postgres container. Required before any performance claim lands
in the README. NOT part of the v1 release; the v1 release ships
without any perf claim.

A second cell, `bench/cells/db-pg-elf-schema.yml`, measures the
`prepare(sql, schema)` validation cost against `prepareRaw(sql)`.

## Risk register

- **Subset regressions in the wrapper.** Mitigation: `scriptc coverage`
  in CI, 100% gate. Same gate as `@chttp/val` and `@chttp/router`.
- **SCRAM-SHA-256 implementation bugs.** Mitigation: parity test
  against PerryTS/postgres; canonical test vectors from RFC 5802;
  manual review against `PerryTS/postgres/src/auth/scram.ts`. The
  test vector set is small (~10 cases) and lives in
  `test/scram-vectors.test.ts`.
- **Wire-protocol version drift.** Mitigation: pin the minimum
  supported Postgres to 13 (Neon/Supabase/RDS all support 13+;
  PostgreSQL >= 7.4 is the wire-protocol baseline); integration tests
  run against `postgres:13`, `postgres:15`, `postgres:17` matrix.
- **The `| undefined` divergence fences subset-clean consumers.**
  Same mitigation as `@cutils/sqlite`: ship `getOrNull`; document in
  `docs/subset-quirks.md`; v2 `nullable: true` open option as the
  long-term fix.
- **Standard Schema spec drift / val coarse `InferOutput` until the
  brand ticket.** The seam pins to spec v1; val's `InferOutput`
  stays best-effort until the T0b brand ticket lands (val-side).
  Runtime is unaffected: validation goes through
  `~standard.validate`, not val's types.
- **Async dispose ordering with `await using` in loops.** scriptc
  0.3.3 supports `await using` in `for` loops; the wrap is
  deterministic (last-in-first-out). The same caveat as the sync
  case applies — nested `await using tx = ...` auto-saves, the
  `Transaction[Symbol.asyncDispose]()` body is the right place.
- **Hand-rolled driver becomes a maintenance burden.** Mitigation: the
  driver is small enough that one human understands it; the wire
  protocol is documented and stable (Postgres 7.4+); the
  `parity.test.ts` against PerryTS/postgres is the regression net.

## Cross-cutting (ripples to other `@cutils/*` packages)

The same Standard-Schema seam skeleton scales to `@cutils/mongo`
(wire protocol over TCP, async, same seam, BSON). The key learnings
from `@cutils/postgres`:

- **Async is fine, `await using` works the same as `using`.** The
  subset `using` audit (`memory:scriptc_using_audit.md`) covers both.
- **Same `getOrNull` parallel** for the `| undefined` fence.
- **Same Standard-Schema seam integration** on `prepare(sql, schema)`
  (no `withSchema` chain, one schema for read+write, lenient insert
  via `Partial<T>`, `*Raw` opt-out).
- **Same auto-savepoint on nested** `await using tx = ...`.
- **Same pool-friendly shape, no pool in v1.** Mongo follows the
  same pattern: `Database.connect()` returns one connection; the
  class is pool-friendly by construction; no `Pool` class in v1.

If `@cutils/postgres` lands, `@cutils/mongo` is the same skeleton on
a different wire (MongoDB OP_MSG, BSON types as wrapper classes
with plain-TS views). Same ~1,500-2,500 LoC envelope, same
deployment shape (one connection per process in v1, user-space pool
on top).

## Task breakdown (T-numbers for the project board)

### T0 — Plan, ticket, project wiring (S, infra)
- [ ] Create GitHub issue "Ship @cutils/postgres v0.1.0" with refined
      fields (iteration: 2026-Q4, effort: L, classification: feature).
- [ ] Link from `.agents/decisions.md` once shipped.

### T0b — `@chttp/val` type-brand ticket (val-side, NOT a blocker, S)
- [ ] Same ticket as `@cutils/sqlite` T0b, re-scoped: land the
      `_t!: T` declared fields on each val schema subclass and
      update `InferOutput<S>` in `packages/val/src/schemas.ts`.
      Not a blocker for this package — typing flows through the
      Standard-Schema spec, so val's coarse `InferOutput` only
      softens autocomplete until it lands; runtime is unaffected.

### T1 — Wire encoder/decoder + MockSocket tests (M, infra)
- [ ] `src/internal/messages.ts` — encoder/decoder for all wire
      messages (no Postgres needed).
- [ ] `src/internal/rows.ts` — DataRow decoder + type OID registry.
- [ ] `test/wire.test.ts` — MockSocket-driven unit tests (~70% of the
      test surface).

### T2 — Connection + TLS + Startup (M, infra)
- [ ] `src/internal/socket.ts` — single-flight writes over `node:net`.
- [ ] `src/internal/tls.ts` — `node:tls` upgrade on `SslRequest`.
- [ ] `src/internal/connect.ts` — `StartupMessage` + `ParameterStatus`
      stream; populate `backendPid` / `backendSecret`.
- [ ] Integration test: connect, run `SELECT 1`, close.

### T3 — SCRAM-SHA-256 auth (M, infra, the hardest part)
- [ ] `src/internal/auth.ts` — SCRAM-SHA-256 client implementation.
- [ ] RFC 5802 canonical test vectors in `test/scram-vectors.test.ts`.
- [ ] Cross-check against `PerryTS/postgres/src/auth/scram.ts`.
- [ ] Integration test: connect with `password`, run `SELECT 1`.

### T4 — Simple Query path (S, feature)
- [ ] `src/internal/simple.ts` — `Q` / `Execute` (no params) path.
- [ ] Methods: `exec()`, `pragma()`, `commit()`, `rollback()`,
      `savepoint()`.
- [ ] Integration test: `BEGIN; SELECT 1; COMMIT;` round-trip.

### T5 — Extended Query path (L, feature, the bulk of v1)
- [ ] `src/internal/extended.ts` — `Parse` / `Bind` / `Describe` /
      `Execute` / `Sync` path.
- [ ] Methods: `prepare(sql, schema)` (Standard-Schema seam, schema
      is the second argument), `prepareRaw(sql)`,
      `Stmt.run/get/getOrNull/all/bind/columns`,
      `Stmt.runRaw/getRaw/allRaw` (no validation).
- [ ] Integration tests: parameter binding (all common OIDs),
      type round-trip, error path (unique violation, FK violation),
      validation on read AND write, `*Raw` opt-out.

### T6 — Transaction + auto-savepoint (S, feature)
- [ ] `Transaction` class with `[Symbol.asyncDispose]()` doing
      auto-commit/rollback + auto-savepoint on nested.
- [ ] Integration test: nested transaction → savepoint; rollback in
      inner → ROLLBACK TO savepoint; outer commits.

### T7 — Standard-Schema seam integration (S, feature)
- [ ] `src/validate.ts` — `prepare(sql, schema)` wires
      `schema["~standard"].validate` into `get`/`all` (output) and
      `run` (input). One schema covers both. `run` input is
      validated against the schema after the user-supplied params
      are coalesced into a row object. `InferOutput<typeof schema>`
      is the row type. The Standard-Schema spec IS the contract:
      `@chttp/val` and valibot are both first-class; no adapter
      layer between them.
- [ ] Integration test: `prepare(sql, schema)` with BOTH
      `@chttp/val` and valibot schemas (seam-proof) validates rows;
      validation errors surface as `PgError` with
      `code: 'VALIDATION'`. `*Raw` opts out.

### T8 — Errors + Cancel + Notify (S, feature)
- [ ] `src/errors.ts` — `PgError` class with the relevant SQLSTATE
      fields populated.
- [ ] `src/internal/cancel.ts` — `Database.cancel(stmt)`.
- [ ] `src/internal/notify.ts` — `LISTEN`/`NOTIFY` background stream.
- [ ] Integration tests: `Database.notify(channel, payload)`,
      `Database.cancel(stmt)` against a long-running query.

### T9 — Tests + example + docs (M, feature, infra)
- [ ] `test/parity.test.ts` — same test suite, both drivers, same
      Postgres, same results.
- [ ] `test/elf.test.sh` — end-to-end ELF smoke.
- [ ] `test/coverage.test.mjs` — `scriptc coverage` 100% gate.
- [ ] `examples/todo-app-postgres/main.ts` — chttp + cutils/postgres
      todo API, ~80 LoC.
- [ ] `docs/integration.md`, `docs/auth.md`, `docs/schema.md`,
      `docs/subset-quirks.md`.
- [ ] `README.md` with copy-pasteable snippets and a
      "PerryTS/postgres users: what changed" section.

### T10 — Release (S, infra)
- [ ] `pnpm change` intent file.
- [ ] Bump via `pnpm version -r`; tag `v<version>`; release
      workflow publishes.

### T11 — Follow-ups (NOT in v1, tracked as separate tickets)
- [ ] Bench cell `bench/cells/db-pg-elf.yml`.
- [ ] Bench cell `bench/cells/db-pg-elf-schema.yml` — measures
      validation cost of `prepare(sql, schema)` against
      `prepareRaw(sql)`.
- [ ] `@cutils/postgres-pool` (or `@cutils/pool-postgres`) — separate
      package; ships a `Pool` class with `acquire(): Promise<Database>`
      and `release(db)`. Lives in its own package so the pool can
      pick its own semantics (FIFO/LIFO/health checks/reconnection/
      per-key) without forcing a choice on every `@cutils/postgres`
      user. The v1 `Database` shape is pool-friendly by construction
      (see "Pool-friendly shape, no pool in v1" above) — this
      follow-up is a *shipped* pool, not a v1 commitment.
- [ ] COPY IN/OUT (v2).
- [ ] Long-lived `LISTEN` consumer (v2).
- [ ] `@cutils/drizzle-postgres` — separate package; maps Drizzle's
      `$inferSelect` to our `Stmt<TRow>`.
- [ ] `nullable: true` connect option — picks the `get()` return
      type at construction time.
- [ ] Vendor-specific schema features — the seam standardizes
      validate + InferOutput only; an opt-in escape hatch for
      validator-specific extras (brands, transforms) if asked.

## References

- Postgres wire spec: <https://www.postgresql.org/docs/current/protocol.html>.
- `pg-protocol` (shape reference): <https://github.com/brianc/node-postgres/tree/master/packages/pg-protocol>.
- PerryTS/postgres (SCRAM, extended query reference): <https://github.com/PerryTS/postgres>.
- `porsager/postgres` (secondary reference): <https://github.com/porsager/postgres>.
- SCRAM-SHA-256 RFC 5802: <https://datatracker.ietf.org/doc/html/rfc5802>.
- `@cutils/sqlite` (the design template):
  `.agents/plans/2026-10-15-cutils-sqlite.md`.
- `memory:cutils_db_val_first.md` — Standard-Schema design rules for
  the whole `@cutils/*` DB family.
- `memory:scriptc_using_audit.md` — confirms `using` and `await using`
  compile in 0.3.3.
- `memory:scope_decisions.md` — `@cutils/*` scope and DB-in-cutils
  policy.
- `packages/val/src/types.ts:47-65` — Standard Schema v1 conformance
  baseline.
- `docs/validation.md` — validation cost context.
