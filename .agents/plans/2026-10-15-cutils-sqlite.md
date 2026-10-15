# @cutils/sqlite — first utility package, 2026-10-15

## What this is

Embedded SQLite for chttp apps, shipped as a TypeScript package that compiles
to a single static binary with `scriptc build`. Users `import { Database }
from "@cutils/sqlite"`, never write a C shim, never see `libsqlite3` on the
linker line. The shim and amalgamation live in the package's `vendor/`
directory and build artifacts are produced by `pnpm build` once per release.

The public TypeScript surface is **inspired by `better-sqlite3` and
`drizzle-orm`** — better-sqlite3's ergonomics, drizzle-orm's strict
type-inference — and uses the **Standard-Schema seam (formerly
val-first) as the source of truth for row types and row
validation**. Drizzle's column-DSL approach does not apply (we have
no `pgTable`); instead, the user writes ONE Standard-Schema
validator (a `@chttp/val` schema, a valibot schema, or any other
conforming validator), hands it to `prepare(sql, schema)`, and
`InferOutput<typeof schema>` is the row type. The same schema is
used for select AND insert (insert is lenient via `Partial<T>`).
This is the design pattern for the rest of the `@cutils/*` DB family
(`@cutils/postgres`, `@cutils/mongo`). The C shim and amalgamation
strategy are unchanged from the original draft.

### Standard-Schema seam, no codegen, no column DSL

We target the Standard Schema v1 spec (`@standard-schema/spec`,
type-only import) rather than any single validator library. The seam
accepts `@chttp/val`, valibot, or any other conforming validator:

- **No second type source.** The schema IS the row type. No
  `pgTable` definition to keep in sync; no `createSelectSchema(table)`
  step; no codegen. Editing the schema updates the row type, the
  validator, and the JSON-Schema output in one place.
- **Subprocess-free.** Any validator that compiles under scriptc
  embeds in the ELF with zero extra moves. `@chttp/val` does today;
  so does valibot 1.5.0 (99% coverage, ELF byte-identical to Node;
  one SC2012 `isFinite` fence in its `_LruCache`; upstream fix
  open-circle/valibot#1708).
- **Convergent with the rest of chttp.** The same Standard-Schema
  validator that validates HTTP request bodies validates DB rows.
  Users write one set of schemas per app and use them everywhere.

Validation runs on read AND write. `prepare(sql, schema)` validates
`get/all/iterate` outputs and `run` (insert/update/delete) inputs.
A `*Raw` family (`getRaw`, `allRaw`, `runRaw`, `prepareRaw`,
`execRaw`) opts out of validation for hot paths.

### Note: no upstream val change required

An earlier draft gated this plan on an upstream `@chttp/val`
type-brand change (declared `_t!: T` fields plus an `InferOutput`
hierarchy walk). That is no longer a blocker: row typing flows
through the spec (`StandardSchemaV1.InferOutput<S>`, aliased once
in the wrapper), so no upstream val change is required. Val's
coarse object inference stays a val-side ergonomics ticket (T0b,
tracked separately); the runtime seam is unaffected.

## Why first

- **Category-creating.** No npm package today ships "TS import → native
  binary → embedded SQLite". `better-sqlite3` requires Node and a `.node`
  addon; `node:sqlite` is refused by scriptc; rolling your own FFI shim is a
  30-90 LoC tarpit per project. This is the first time a JS developer can
  write `import { Database } from "@cutils/sqlite"` and have the entire
  stack compile to a static ELF with zero external dependencies.
- **DX precedent.** It is the cleanest example of the "bigger binary, no C
  shim required" policy. If this package is wrong, every downstream
  `@cutils/*` package that owns its own C dependency (e.g. LMDB-cache via
  `@cutils/cache`'s persistent tier) is wrong in the same way.
- **Already verified.** `docs/native.md:93` documents a working 30-line
  libsqlite3 shim: `shim_open` / `shim_exec` / `shim_count` compiled with
  `cc -c`, linked via `libraries: ["./shim.o", "libsqlite3.a"]`, runs
  `CREATE TABLE` / `INSERT` / `SELECT count(*)` from a compiled ELF. The
  80% use case is proven; the design here extends it to prepared
  statements with schema-typed row inference, transactions, parameter
  binding, and a real subset-clean wrapper API.
- **DX target user is JS/TS, not systems programmers.** The whole point of
  chttp is to give web developers a path to native binaries. Asking them
  to vendor amalgamation files, write C FFI shims, and wire `pkg-config`
  would invert the project's reason for existing.

## Non-goals

- An ORM, query builder, or migration tool. `@cutils/sqlite` exposes the C
  API's shape (parameterized statements, transactions, manual type
  coercion) with a thin ergonomic layer. A separate `@cutils/drizzle-sqlite`
  may be built on top later; in v1 the surface is the wire + types, not a
  DSL.
- Async I/O. SQLite is single-threaded by design; the FFI surface is sync.
  This is also what makes the wrapper scriptc-clean — no `await`, no
  `Promise`, no `EventTarget`. The `using` block syntax is the only
  asynchronous-feeling surface.
- Replication, clustering, hot backup, or anything beyond the SQLite C
  library's documented surface. (`libSQL`'s additional features stay out
  until a separate package that links `libsql.so` is justified.)
- Replacing `examples/sqlite-ffi/`. That example remains as the
  educational artifact: it shows what `@cutils/sqlite` does for you, ~30
  LoC of C and a manifest. After `@cutils/sqlite` lands, the example's
  README links to the package and recommends it for production use.

## Public surface

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Database, Stmt, Transaction, SqliteError } from "@cutils/sqlite";

// Local alias over the spec's InferOutput. Type-only; erases at
// compile time, so @standard-schema/spec is not a runtime dep.
type InferOutput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

export type SqlValue = number | bigint | string | null | Uint8Array;
export type BindValue = SqlValue | boolean;        // boolean binds as 0/1
export type Row = Record<string, SqlValue>;
export interface RunResult { changes: number; lastInsertRowid: number; }
export interface OpenOpts { readonly?: boolean; fileMustExist?: boolean; }

export class SqliteError extends Error {
  code: string;                                    // SQLITE_CONSTRAINT_UNIQUE etc.
  constructor(code: string, message: string);
}

export class Database implements Disposable {
  static open(path: string, opts?: OpenOpts): Database;
  static openInMemory(): Database;

  readonly path: string;
  readonly memory: boolean;
  readonly readonly: boolean;
  readonly inTransaction: boolean;

  exec(sql: string): void;                          // multi-stmt, no params
  execRaw(sql: string): void;                       // same, no validation
  pragma(sql: string): { rows: Row[] };
  transaction(): Transaction;                       // returns the OBJECT, not a wrapper fn

  // prepare() — schema attached at prepare time, NOT chained.
  // TRow = InferOutput<schema> (read). Validation runs on get/all
  // (read) and run (write; lenient via Partial<TRow>).
  // The bind shape (anonymous params `?,?` vs named `@x,:x,$x`) is
  // declared by the user via the bind-arg shape passed to
  // run/get/all — the SQL text itself determines which bind shape
  // is legal. prepare() returns a Stmt<unknown, TRow> that overloads
  // its run/get/all methods for both shapes (see Stmt below).
  prepare<Schema extends StandardSchemaV1>(
    sql: string,
    schema: Schema,
  ): Stmt<InferOutput<Schema>>;
  // prepareRaw — untyped escape hatch. No schema, no validation,
  // TRow is unknown.
  prepareRaw(sql: string): Stmt<unknown>;

  lastInsertRowid(): number;
  changes(): number;
  close(): void;
  [Symbol.dispose](): void;                         // alias of close()
}

// TRow = read row type (InferOutput<schema>, or unknown for prepareRaw).
// Insert accepts the row value as the bind arg directly; the wrapper
// validates it against the schema (or skips validation on `*Raw`).
// The Stmt class is generic only over TRow. The run/get/all methods
// are overloaded to accept either:
//   - a tuple of BindValue (for anonymous params `?,?`)
//   - a record of BindValue (for named params `@x,:x,$x`)
// TypeScript picks the right overload at the call site based on
// whether the user passed a tuple or a record.
export class Stmt<TRow = unknown> implements Disposable {
  readonly source: string;
  readonly reader: boolean;                         // returns rows
  readonly readonly: boolean;                       // no DML
  readonly database: Database;
  readonly schema: StandardSchemaV1 | null;         // null on prepareRaw

  // Validated paths. Insert inputs are validated against the schema
  // before binding; read outputs are validated after step().
  // Two overloads each: tuple (anonymous) and record (named).
  run(params: BindValue[]): RunResult;
  run(params: Record<string, BindValue>): RunResult;
  get(params: BindValue[]): TRow | undefined;        // see "Known divergence" below
  get(params: Record<string, BindValue>): TRow | undefined;
  getOrNull(params: BindValue[]): TRow | null;       // subset-strict variant
  getOrNull(params: Record<string, BindValue>): TRow | null;
  all(params: BindValue[]): TRow[];
  all(params: Record<string, BindValue>): TRow[];
  bind(params: BindValue[]): this;                   // permanent bind
  bind(params: Record<string, BindValue>): this;

  // Raw paths — no validation. Same wire format, untyped return.
  runRaw(params: BindValue[]): RunResult;
  runRaw(params: Record<string, BindValue>): RunResult;
  getRaw(params: BindValue[]): unknown;
  getRaw(params: Record<string, BindValue>): unknown;
  allRaw(params: BindValue[]): unknown[];
  allRaw(params: Record<string, BindValue>): unknown[];

  columns(): Array<{
    name: string; column: string | null; table: string | null;
    database: string | null; type: string | null;
  }>;
  toString(): string;                               // expanded SQL after bind

  finalize(): void;
  [Symbol.dispose](): void;                         // alias of finalize()
}

export class Transaction implements Disposable {
  readonly database: Database;
  exec(sql: string): void;
  execRaw(sql: string): void;
  // Transaction-scoped prepare() — same seam shape as Database.prepare.
  prepare<Schema extends StandardSchemaV1>(sql: string, schema: Schema):
    Stmt<InferOutput<Schema>>;
  prepareRaw(sql: string): Stmt<unknown>;
  savepoint(name: string): Transaction;             // explicit savepoint
  commit(): void;                                   // auto on clean dispose()
  rollback(): void;                                 // auto on dispose()-after-throw
  [Symbol.dispose](): void;                         // auto-detect nested = savepoint
}
```

### Why this shape

1. **better-sqlite3 ergonomics, narrowed.** `prepare().get/all/run/bind()`,
   `exec`, `pragma`, `transaction()`, columns metadata, source SQL, `using`
   via `[Symbol.dispose]()`. Same `Stmt.reader` / `Stmt.readonly`
   introspection. The C shim's `step()` becomes `Stmt.get/all/run` — the
   shim doesn't have a separate `step()` because nothing in the public
   surface needs one.
2. **A Standard-Schema validator as the row type, no codegen.** The
   user writes ONE schema (`@chttp/val`, valibot, any conforming
   library); `prepare(sql, schema)` makes `get/all` return
   `InferOutput<typeof schema>` and `run` accept `Partial<typeof schema>`
   (lenient insert). The same schema is the validator at runtime
   (via `schema['~standard'].validate`). No codegen, no column DSL,
   no `pgTable`, no `InferModelFromColumns`. The cost: the user maintains
   the schema in lockstep with the SQL DDL (e.g. an `INTEGER PRIMARY
   KEY` column should be `optional()` in the schema so that
   `Partial<TRow>` permits `undefined` for autoincrement inserts). The
   win: subset-clean, no Proxy, no query builder, no hidden instance
   state, the same schema validates HTTP request bodies and DB rows.
3. **Schema attached at `prepare()` time, not chained.** The schema
   is the second argument to `prepare()`, not a fluent
   `stmt.withSchema(s)` chain. `withSchema` is method shorthand,
   subset-banned in scriptc; the schema belongs with the prepared
   statement anyway. `prepare(sql, schema)` returns a `Stmt<...,
   InferOutput<typeof schema>>`; `prepareRaw(sql)` is the untyped
   escape hatch (no schema, no validation). Same pattern in
   `@cutils/postgres` and `@cutils/mongo`.
4. **`using` shape, not closure form.** `using db = Database.open(...)`
   and `using tx = db.transaction()`. NEVER `db.transaction(fn)`. The
   `using` block is what scriptc 0.3.3 lowers statically; it's the
   exactly-correct mechanism for both the database lifetime and the
   transaction lifetime. `Transaction[Symbol.dispose]()` does
   auto-commit on clean exit, auto-rollback on throw, and auto-savepoint
   when nested (detected by `this._parent !== null`).
5. **No monkeypatching.** Drop `pluck`, `expand`, `raw` (statement-level),
   `defaultSafeIntegers`, `unsafeMode`, `function`, `aggregate`, `table`,
   `loadExtension`, `backup`, `serialize`, `deserialize`, `verbose`,
   `explain`. All are subset-hostile AND user-hostile. A monkey-free API
   is the whole point. (We DO add a per-call `*Raw` family that
   intentionally opts out of validation for hot paths — that's
   opt-in, not monkeypatching.)
6. **Subset-clean seam access.** Validation runs
   `schema["~standard"].validate(row)`. Property access on the
   declared spec shape is structural, so it survives the subset gate
   (contrast: hono's `this.router.match` SC1090 is an interface-typed
   method call, not a declared property).

### Known divergence: `get()` returns `undefined`, not `null`

`ARCHITECTURE.md:87` bans `| undefined` in the scriptc subset. better-sqlite3
and `node:sqlite` both return `undefined` from `get()`. We match
better-sqlite3 for **agent-first readability** (the user picked this in
review): a maintainer reading `@cutils/sqlite` and `better-sqlite3` side by
side sees the same shape.

For callers that want to stay subset-clean, we ship a parallel method:

```ts
getOrNull(params: BindValue[] | Record<string, BindValue>): TRow | null;
```

`getOrNull` is the same C call with a different return-type branch; ~5 LoC
in the wrapper. Subset-strict callers use `getOrNull`; everyone else uses
`get`. Documented in the README's "subset quirks" section.

### What we DON'T ship (and why)

| Dropped | Reason |
| --- | --- |
| `iterate()` | async generators / `function*` are subset-fenced; `for (const r of stmt.all()) {}` is one more character |
| `pluck(true)` / `expand(true)` / `raw(true)` | statement-level mode flags that mutate return type by side effect; subset ban on monkeypatching |
| `defaultSafeIntegers(true)` / `stmt.safeIntegers(true)` | global mode toggle that changes return type of every call; use a per-row-type generic instead |
| `unsafeMode(true)` | `SQLITE_THREADSAFE=0` + single-connection model make this a no-op; refuses to silently turn errors into `undefined` returns |
| `function(name, opts, fn)` | UDFs need function values inside records (subset ban) + global connection state mutation |
| `aggregate(name, opts)` | same; `step`/`inverse`/`result` shape is function values in a record |
| `table(name, def)` | virtual tables; function values + `function*` generators |
| `loadExtension(path, entry)` | `SQLITE_OMIT_LOAD_EXTENSION` build flag; loading is gone |
| `backup(dest, opts)` | needs async + connection lock; v2 if asked |
| `serialize()` / `deserialize(buf)` | replace with `exec("VACUUM INTO '...'")` for file copy; `:memory:` for in-process |
| `verbose` option | no implicit tracing hooks; user wraps `exec`/`prepare`/`step` if they want it |
| `db.transaction(fn)` closure form | `using tx = db.transaction()` replaces it; closure form is the "obscure behaviour" the user wants to avoid |
| `explain(sql)` | `db.exec("EXPLAIN " + sql)` works fine; not 80% use case |
| `Buffer` for BLOB | `Uint8Array` is web-standard and subset-clean; matches `node:sqlite` |

## The C shim — `vendor/shim/sqlite_shim.c`

Approximately 200-300 LoC of C. Stateless where possible. Every entry
point takes the connection or statement handle as the first argument so
the wrapper can multiplex. The shim is the **only** C code users have to
trust; the amalgamation is upstream, unmodified, and the public-domain
license makes distribution trivial.

| Entry point | Purpose | FFI format |
| --- | --- | --- |
| `shim_open(path, flags) -> handle` | Open or create a database | 7 (returns `pointer`/`bigint`) |
| `shim_close(handle) -> errcode` | Close and free the connection | 1 (void return) |
| `shim_exec(handle, sql) -> errcode` | Multi-statement exec, no params | 1 (cstring) |
| `shim_prepare(handle, sql) -> stmt_handle` | Compile a parameterized statement | 7 (pointer) |
| `shim_bind_int(stmt, idx, val)` | Bind INTEGER (i64) | 7 (i64) |
| `shim_bind_dbl(stmt, idx, val)` | Bind REAL (f64) | 1 (f64) |
| `shim_bind_text(stmt, idx, val, len)` | Bind TEXT (UTF-8 borrowed) | 1 (f64 + cstring + u32) |
| `shim_bind_blob(stmt, idx, val, len)` | Bind BLOB (borrowed bytes) | 6 (mutable-bytes) |
| `shim_bind_null(stmt, idx)` | Bind NULL | 1 |
| `shim_step(stmt) -> row_status` | Execute/fetch; `0`=row, `101`=done, else `errcode` | 1 |
| `shim_column_count(stmt) -> i32` | Number of columns in result set | 1 |
| `shim_column_name(stmt, idx, buf, len) -> written` | Column name into caller buffer | 6 (mutable-bytes) |
| `shim_column_type(stmt, idx) -> i32` | SQLITE_INTEGER/TEXT/BLOB/REAL/NULL | 1 |
| `shim_column_int64(stmt, idx) -> i64` | INTEGER column | 7 |
| `shim_column_dbl(stmt, idx) -> f64` | REAL column | 1 |
| `shim_column_text(stmt, idx, buf, len) -> written` | TEXT column into caller buffer | 6 |
| `shim_column_blob(stmt, idx, buf, len) -> written` | BLOB column into caller buffer | 6 |
| `shim_reset(stmt) -> errcode` | Reset for re-execution | 1 |
| `shim_finalize(stmt) -> errcode` | Free compiled statement | 1 |
| `shim_last_insert_rowid(handle) -> i64` | Rowid of last INSERT | 7 |
| `shim_changes(handle) -> i32` | Rows changed by last statement | 1 |
| `shim_begin(handle) -> errcode` | BEGIN | 1 |
| `shim_commit(handle) -> errcode` | COMMIT | 1 |
| `shim_rollback(handle) -> errcode` | ROLLBACK | 1 |
| `shim_savepoint(handle, name, op) -> errcode` | SAVEPOINT/RELEASE/ROLLBACK TO | 1 |
| `shim_errmsg(handle, buf, len) -> written` | Last error message | 6 |

~26 entries (added `shim_savepoint` for the auto-savepoint on nested
transactions). The FFI manifest is one JSON file, generated by a
`pnpm build` step so the `declare function` declarations and the C
signatures cannot diverge.

The text/blob/errmsg writes are **out parameters**: caller passes a
`Uint8Array`, shim writes up to `len` bytes and returns the count. Format
6 `mutable-bytes` is the right call here — it is a borrowed, writable
view; in-place writes are visible through the original array. The wrapper
owns the buffer and reuses it across calls.

## The amalgamation — `vendor/sqlite-amalgamation/`

Vendored from `https://www.sqlite.org/amalgamation.html` (public domain).
The exact version is pinned in `vendor/sqlite-amalgamation/SQLITE_VERSION`
and recorded in the package's `CHANGELOG.md`. Build picks up `sqlite3.c`
and `sqlite3.h` from this directory, compiles with `-O2
-DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION` (single-threaded; no
extension loading — both keep the binary small and remove attack
surface).

Resulting `libsqlite3.a` is 1.0-1.6 MB before linker GC; the scriptc
binary after dead-stripping the C runtime is typically 200-500 KB. The
README documents expected binary sizes for `hello world` (just `scriptc`
overhead), `route + chttp + sqlite` (the typical use case), and a
worst-case "every public symbol used" build.

## Build pipeline — `package.json` scripts

```
"scripts": {
  "build:vendor":  "tsc vendor/manifest.gen.ts && node vendor/manifest.gen.ts > vendor/manifest.json",
  "build:c":       "cc -O2 -c vendor/shim/sqlite_shim.c -o build/sqlite_shim.o",
  "build:sqlite":  "cc -O2 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -c vendor/sqlite-amalgamation/sqlite3.c -o build/sqlite3.o",
  "build:archive": "ar rcs build/libsqlite3-shim.a build/sqlite_shim.o build/sqlite3.o",
  "build:lib":     "ranlib build/libsqlite3-shim.a",
  "build:ts":      "tsc -p tsconfig.json",
  "build":         "pnpm build:vendor && pnpm build:c && pnpm build:sqlite && pnpm build:archive && pnpm build:lib && pnpm build:ts"
}
```

The manifest generator walks the C header (or a hand-maintained symbol
table) to emit the JSON. Hand-maintaining ~26 entries is also fine; the
generator just guarantees the `declare function` signatures match the C
signatures.

## Testing strategy

1. **C shim unit tests** (`test/shim.test.c`) — C-level test harness using
   `assert.h` and a temp file. Verifies open, exec, prepare, step, bind
   variants, transaction, savepoint, error paths. Run with
   `cc test/shim.test.c build/libsqlite3-shim.a -o build/shim_test &&
   ./build/shim_test`.
2. **TS wrapper unit tests** (`test/wrapper.test.ts`) — runs under plain
   `node` with a CJS shim that re-exports the manifest + uses `koffi` to
   call the shim. Verifies parameter binding (anonymous + named), row
   iteration, transaction commit/rollback/savepoint, `using` semantics,
   `bigint` handling, `Uint8Array` blob round-trip, error propagation,
   `getOrNull` parallel to `get`, Standard-Schema `prepare(sql,
   schema)` integration (one schema for read+write, insert lenient
   via `Partial<T>`, `*Raw` opts out of validation, `prepareRaw`
   untyped). Seam proof: the same fixtures run through BOTH a
   `@chttp/val` schema and a valibot schema.
3. **Subset gate** (`test/coverage.test.mjs`) — runs `scriptc coverage` on
   the wrapper source. 100% coverage required, matching `@chttp/val` and
   `@chttp/router`.
4. **End-to-end smoke** (`test/elf.test.sh`) — `scriptc build` a small
   program that opens an in-memory DB, inserts rows, queries them, prints.
   Run, assert output. Catches ABI mismatches and FFI wiring bugs that
   coverage misses.
5. **Conformance** — re-run a subset of the SQLite Tcl test suite against
   the vendored amalgamation. Confirms the amalgamation is unchanged
   from upstream; failures mean a vendor drift, not a `@cutils/sqlite`
   bug.

Test baselining per global rule 9c: full suite →
`/tmp/cutils-sqlite-baseline-<ts>.log` before iterating, diff before done.

## File layout

```
packages/sqlite/
├── AGENTS.md             # subset bans + FFI rules + testing rules
├── README.md             # usage, sizing, examples, "subset quirks" section
├── CHANGELOG.md
├── package.json          # name: @cutils/sqlite; exports map; build scripts
├── tsconfig.json         # subset-strict (no Map, no for...in, etc.)
├── src/
│   ├── index.ts          # public surface: Database, Stmt, Transaction
│   ├── types.ts          # BindValue, SqlValue, Row, OpenOpts, RunResult
│   ├── errors.ts         # SqliteError class, error code mapping
│   ├── validate.ts       # Standard-Schema integration:
│   │                     # prepare(sql, schema) wires the schema's
│   │                     # '~standard'.validate into get/all/run;
│   │                     # Partial<T> for lenient insert; *Raw opt-out
│   └── internal/
│       ├── ffi.ts        # generated declare functions + manifest loader
│       ├── buffer.ts     # reusable scratch buffer for text/blob reads
│       ├── utf8.ts       # string ↔ UTF-8 byte conversion (subset-clean)
│       └── savepoint.ts  # SAVEPOINT name generator + nested detection
├── vendor/
│   ├── manifest.gen.ts   # source-of-truth for ffi.json (or hand-maintained)
│   ├── manifest.json     # generated; consumed by scriptc --ffi
│   ├── shim/
│   │   └── sqlite_shim.c # the C shim (≈200-300 LoC)
│   ├── sqlite-amalgamation/
│   │   ├── sqlite3.c
│   │   ├── sqlite3.h
│   │   └── SQLITE_VERSION
│   └── README.md         # provenance, license (public domain), checksum
├── test/
│   ├── shim.test.c       # C unit tests
│   ├── wrapper.test.ts   # TS wrapper tests (Node + koffi)
│   ├── coverage.test.mjs # scriptc coverage gate
│   └── elf.test.sh       # end-to-end ELF smoke
├── examples/
│   └── todo-app/
│       ├── main.ts       # a real example: routes + chttp + sqlite
│       └── README.md
└── docs/
    ├── integration.md    # how to wire into a chttp app
    ├── schema.md         # Standard-Schema integration deep-dive;
    │                     # @chttp/val + valibot as first examples
    └── subset-quirks.md  # get() / getOrNull, the |undefined surface
```

## Dependencies

- `better-sqlite3` is **not** a dependency (it is a Node addon and the
  whole point is to not need one).
- **Zero runtime dependencies.** `@standard-schema/spec` is a
  type-only import: compile-time only, types erase at compile, not a
  runtime dep. Runtime validation goes through the seam,
  `schema["~standard"].validate(value)`.
- The seam IS the contract. `@chttp/val`, valibot, or any other
  Standard-Schema validator is just a conforming validator at the
  boundary; the wrapper imports nothing validator-specific.
- Dev-deps: `@chttp/val` + `valibot` for seam-proof tests. Every
  schema/validate fixture runs through BOTH validators.
- `koffi` is **dev-only**, used by `test/wrapper.test.ts` to run the
  wrapper under plain Node.

## Scope discipline

- **Do not** add an ORM, query builder, or migration tool. If a user
  needs one, it lives in a separate package (`@cutils/drizzle-sqlite` or
  similar) that depends on `@cutils/sqlite` plus a query builder.
- **Do not** add an async wrapper. SQLite is sync; the FFI is sync.
  Trying to fake async adds subset noise (Promises, event loop) and
  zero user value.
- **Do not** bundle `libSQL`, encryption extensions, or
  full-text-search extensions in v1. They are separate `--ffi` builds.
- **Do not** remove `examples/sqlite-ffi/`. The example still teaches
  the FFI pattern for users who need a custom C library; it links to
  `@cutils/sqlite` from its README as the production path.
- **Do not** widen the public surface beyond the ~16 methods above. A
  new method is a manifest entry, a `declare function`, a TS wrapper, a
  test, and a docstring — too high a cost to add speculatively.
- **Do not** auto-attach schemas. The user opts in by passing the
  schema to `prepare(sql, schema)`. No `db.useValidator()` global; no
  implicit schema lookup by table name; no `db.attach(schema)` side
  effect. The schema lives with the prepared statement.
- **Do not** widen the prepare signature to accept a column DSL.
  Standard-Schema validators only. If a user wants a Drizzle-style
  `pgTable` mapping, they use `@cutils/drizzle-sqlite` (a separate
  package built on top of `@cutils/sqlite`).

## Bench cell (required before any perf claim)

`bench/cells/db-elf.yml` — measures `INSERT` and `SELECT` throughput on
`@cutils/sqlite` against `better-sqlite3` under Node 24. Required before
any performance claim lands in the README. NOT part of the v1 release;
the v1 release ships without any perf claim. The first perf claim
arrives in a follow-up release after the bench cell is in place.

A second cell, `bench/cells/db-elf-schema.yml`, measures the
`prepare(sql, schema)` validation cost against unvalidated
`prepareRaw(sql)`. Same gate: required before the README can claim
"validation cost < 30%".

## Risk register

- **Amalgamation drift.** Mitigation: pin version, vendor checksum, run
  upstream's Tcl test suite in CI. A drift = new release of
  `@cutils/sqlite` with bumped `SQLITE_VERSION` and a `pnpm change`
  entry.
- **Subset regressions in the wrapper.** Mitigation: `scriptc coverage`
  in CI, 100% gate. Same gate as `@chttp/val` and `@chttp/router`.
- **The `| undefined` divergence fences subset-clean consumers.**
  Mitigation: ship `getOrNull()`; document the rule in `docs/subset-quirks.md`;
  treat any caller that hits the fence as a bug we should design out in
  v2 (likely path: a `nullable: true` open option that picks the
  return type at construction time).
- **FFI ABI break on a new scriptc release.** Mitigation: every
  `@chttp/*` and `@cutils/*` package pins its FFI manifest version;
  rebuild the archive; CI runs `scriptc build` against the pinned
  version. If scriptc bumps ABI, a new release of the package is
  mandatory (per the 0.3.3 ABI v21 break precedent).
- **The 200-300 LoC shim becomes a maintenance burden.** Mitigation: the
  shim is small enough that one human understands it; the C library is
  public domain and stable; the wrapper layer is the user-facing API
  and absorbs future shim changes.
- **Standard Schema v1 spec drift / validator metadata quirks.**
  Mitigation: the seam is the spec (`schema["~standard"].validate`),
  not any validator's internal API; a spec-level breaking change is a
  v2 release of this package. Validator-side quirks stay type-level
  (e.g. val's `InferOutput` remains coarse until its type-brand
  ticket lands); the runtime seam is unaffected.
- **Schema maintainability.** The user maintains the schema in
  lockstep with the SQL DDL. The wrapper's `validate.ts` does NOT
  auto-generate schemas from the table or vice versa. Drift between
  schema and DDL is a user bug, surfaced immediately on the first
  insert/select that hits a column whose type changed. Mitigation:
  the example app (`examples/todo-app/`) doubles as a worked schema
  + DDL pair; `docs/integration.md` includes a "DDL ↔ schema parity"
  checklist.

## Cross-cutting (ripples to other `@cutils/*` packages)

The same Standard-Schema seam scales to `@cutils/postgres` and
`@cutils/mongo`:

- `@cutils/postgres`: every method that returns a sync value in
  `@cutils/sqlite` returns a `Promise<...>` here. `Database implements
  AsyncDisposable`, `[Symbol.asyncDispose]()`. `BindValue` widens to
  include `Date` (timestamp), `boolean` (real). `TRow` can include
  `Date`, `bigint` (i64), `Uint8Array`. Hand-rolled, NOT vendored from
  PerryTS/postgres. Same `prepare(sql, schema)` signature; `*Raw`
  family returns `Promise<unknown>`. No `Pool` class in v1 — the
  `Database` shape is pool-friendly (no global state, no singleton,
  `[Symbol.asyncDispose]()` is the release primitive) so a user-side
  pool is ~50-100 LoC on top of public surface. A separate
  `@cutils/postgres-pool` package is a v2 ticket.
- `@cutils/mongo`: same shape as `@cutils/postgres` (async,
  Standard-Schema seam, same `*Raw` family). `BindValue` includes BSON `ObjectId`, `Date`,
  `Binary`. `TRow` is `TDoc` — the user's document type — and BSON
  fields use wrapper classes with plain-TS views. `Collection<TDoc>` is
  a thin generic over the typed collection. No joins, no transactions
  in the v1 surface (MongoDB + Azure CosmosDB + AWS DocumentDB +
  FerretDB compat layer; FerretDB does not implement transactions).
- All three: same `prepare(sql, schema)` Standard-Schema integration,
  same one-schema-read-and-write discipline, same lenient-insert via
  `Partial<T>`, same `*Raw` opt-out, same no-monkeypatching rule,
  same `using` / `[Symbol.dispose | Symbol.asyncDispose]()` ergonomics.
- All three: no shared prerequisite; the seam's types erase at
  compile (T0b is a val-side ticket only).

## Task breakdown (T-numbers for the project board)

### T0 — Plan, ticket, project wiring (S, infra)
- [ ] Create GitHub issue "Ship @cutils/sqlite v0.1.0" with refined
      fields (iteration: 2026-Q4, effort: L, classification: feature).
- [ ] Link from `.agents/decisions.md` once shipped.

### T0b — val-side type-brand ticket (NOT a blocker for @cutils/sqlite)
- [ ] `@chttp/val` ergonomics improvement, tracked separately:
      declared `_t!: T` fields on each concrete schema subclass in
      `packages/val/src/schemas.ts` plus an `InferOutput` hierarchy
      walk, so val's own inference stops returning
      `{ [k: string]: unknown }` for object shapes.
      `@cutils/sqlite` row typing comes from the spec's
      `StandardSchemaV1.InferOutput<S>` and does not wait on this.

### T1 — Vendor amalgamation, write shim (M, infra)
- [ ] Pick a pinned SQLite version (3.46+ for the public-domain
      dedication and 2024-2025 fixes; verify license status in the
      chosen release notes).
- [ ] Vendor `sqlite3.c` + `sqlite3.h` + `SQLITE_VERSION` to
      `vendor/sqlite-amalgamation/`. Record SHA-256 of both files in
      `vendor/README.md`.
- [ ] Write `vendor/shim/sqlite_shim.c` covering the ~26 entry points
      (add `shim_savepoint` for the auto-savepoint path).
- [ ] `test/shim.test.c` covering all paths.

### T2 — FFI manifest + declare functions (S, infra)
- [ ] Hand-write or generate `vendor/manifest.json`.
- [ ] `src/internal/ffi.ts` with `declare function` block matching
      manifest.

### T3 — TS wrapper (M, feature)
- [ ] `src/index.ts` with `Database`, `Stmt`, `Transaction`, errors,
      the public types in `src/types.ts`.
- [ ] One `prepare(sql, schema)` signature (schema is the second
      argument, not an options bag). The returned `Stmt` overloads
      `run/get/all/bind` for both bind shapes (anonymous tuple vs
      named record) — the caller's arg type picks the overload.
      `get` returns `TRow | undefined`, `getOrNull` returns
      `TRow | null`. `run` validates the input against the schema
      and accepts `Partial<TRow>` (lenient insert; an `INTEGER
      PRIMARY KEY` column should be `optional()` in the schema so
      `Partial<TRow>` permits `undefined` for autoincrement).
- [ ] `*Raw` family on both `Database` and `Stmt`:
      `db.execRaw`, `db.prepareRaw`, `stmt.runRaw`, `stmt.getRaw`,
      `stmt.allRaw`. Same wire format, no validation, `unknown`
      return types.
- [ ] `Transaction[Symbol.dispose]()` with auto-commit/rollback +
      auto-savepoint on nested.
- [ ] Standard-Schema integration in `src/validate.ts`:
      `prepare<Schema extends StandardSchemaV1>(sql, schema)` wires
      `schema["~standard"].validate` into `get`/`all` (output) and
      `run` (input). One schema covers both. `run` input is
      validated against the schema after the user-supplied params
      are coalesced into a row object. `InferOutput<Schema>` (local
      alias over `StandardSchemaV1.InferOutput<S>`) is the row
      type; no validator-specific import anywhere in `src/`.
- [ ] Subset-clean: no `Map` / `Set`, no `Object.create(null)`, no
      `??`, no `?.`, no `|undefined` except in the documented
      `get()` and the `Stmt` slot, indexed `for` loops only, no
      class-field initializers. `scriptc coverage` 100% gate passes
      even though `get()` carries `|undefined` — the gate runs on
      the wrapper, not on user code, and the wrapper is the *only*
      place `|undefined` is allowed.
- [ ] `[Symbol.dispose]()` zero-arg methods on `Database`, `Stmt`,
      `Transaction`.

### T4 — Tests (M, feature)
- [ ] `test/wrapper.test.ts` under Node + koffi, exercising
      anonymous + named params, `get`/`getOrNull` parity, and the
      `prepare(sql, schema)` seam proof: the SAME fixtures run
      through BOTH a `@chttp/val` schema and a valibot schema (one
      schema for read+write, insert lenient via `Partial<T>`,
      validation errors surface as `SqliteError` with
      `code: 'VALIDATION'`), `*Raw` opt-out, `prepareRaw` untyped,
      transaction + savepoint, error propagation.
- [ ] `test/coverage.test.mjs` for `scriptc coverage` 100% gate.
- [ ] `test/elf.test.sh` end-to-end smoke.

### T5 — Example app + docs (S, docs)
- [ ] `examples/todo-app/main.ts` — a chttp + sqlite todo API,
      ~80 LoC, reads as a tutorial. Uses `getOrNull` to stay
      subset-clean.
- [ ] `docs/integration.md` — installing, opening, transactions,
      prepared statements, the `using` pattern, error handling,
      bigint notes, binary-size expectations.
- [ ] `docs/schema.md` — Standard-Schema integration deep-dive;
      `@chttp/val` + valibot as first examples; val is NOT the only
      supported validator (any Standard-Schema validator works).
- [ ] `docs/subset-quirks.md` — the `get()` / `getOrNull` rule, the
      `|undefined` fence, how to write subset-clean consumer code.
- [ ] `README.md` with copy-pasteable snippets, binary-size table,
      and a "Better-sqlite3 users: what changed" section.

### T6 — Release (S, infra)
- [ ] `pnpm change` intent file.
- [ ] Bump via `pnpm version -r`; tag `v<version>`; release
      workflow publishes.

### T7 — Follow-ups (NOT in v1, tracked as separate tickets)
- [ ] Bench cell `bench/cells/db-elf.yml` — required before any
      perf claim in README.
- [ ] Bench cell `bench/cells/db-elf-schema.yml` — measures
      validation cost of `prepare(sql, schema)` against
      `prepareRaw(sql)`.
- [ ] `@cutils/drizzle-sqlite` — separate package; maps Drizzle's
      `$inferSelect` to our `Stmt<TRow>`.
- [ ] `nullable: true` open option — picks the `get()` return
      type at construction time, eliminating the `getOrNull`
      parallel.
- [ ] Vendor-specific schema features (val brands, valibot
      transforms), only if demand. The seam itself is the v1 design,
      not a follow-up.

## References

- `docs/native.md:93` — verified 30-line libsqlite3 shim under
  scriptc.
- `examples/ws-echo` — FFI pattern (manifest + `declare function` +
  C shim + `scriptc build --ffi`).
- `packages/router/AGENTS.md` — subset bans and the FFI test
  pattern.
- `packages/val/src/types.ts:47-65` — Standard Schema v1
  conformance baseline.
- `docs/validation.md` — validation cost context (~26% perf hit on
  ELF, what to expect for `withSchema`).
- `memory:scriptc_using_audit.md` — confirms `using` compiles in
  0.3.3.
- `memory:cutils_db_design.md` — design rules for the whole
  `@cutils/*` DB family.
- `memory:scope_decisions.md` — `@cutils/*` scope and DB-in-cutils
  policy.
- `memory:vendor_candidates.md` — vendor reasoning.
- better-sqlite3 raw surface: `https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md`.
- drizzle-orm inference model: `drizzle-orm/src/table.ts`
  `InferModelFromColumns` / `InferSelectModel`.
- Standard Schema spec: `https://standardschema.dev/`.
- Upstream: <https://www.sqlite.org/amalgamation.html> (public
  domain).
