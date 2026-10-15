# @cutils/sqlite

Embedded SQLite for scriptc: the amalgamation vendored in-package, a ~26-entry
C shim over the scriptc span FFI ABI, and a subset-clean TypeScript wrapper
(`Database` / `Stmt<TRow>` / `Transaction` / `SqliteError`). The same source
runs under plain Node (via the shipped shared-library build + koffi) and
compiles through `scriptc build` into a single static ELF with the database
linked in — no external dependency at either end.

```ts
import { Database } from "@cutils/sqlite";
import * as v from "@chttp/val";

const Todo = v.strictObject({
  id: v.number(),
  title: v.string(),
  done: v.number(),
});

const db = Database.open("app.db");
db.exec(
  "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0)",
);

// Validating statements: params and rows are checked by the Standard-Schema
// validator — any compliant library works (val, valibot, ...).
const ins = db.prepare(
  "INSERT INTO todos (title, done) VALUES (:title, :done)",
  Todo,
);
ins.run({ title: "ship it", done: 0 });

const one = db.prepare("SELECT id, title, done FROM todos WHERE id = ?", Todo);
const row = one.getOrNull([1]); // TRow | null

using tx = db.transaction(); // auto-commit on dispose, auto-rollback on throw
db.exec("INSERT INTO todos (title) VALUES ('in tx')");

// Opt out of validation anywhere with the *Raw family.
const raw = db.prepareRaw("SELECT COUNT(*) AS n FROM todos");
const { n } = raw.getOrNull([]);

db.close();
```

## Opening

```ts
Database.open(path, opts?)            // file DB; creates by default
Database.openInMemory()               // ":memory:" — fast + transient
```

`opts.readonly` opens read-only (implies `fileMustExist`); `opts.fileMustExist`
fails when the file is absent. Getters: `db.path`, `db.memory`, `db.readonly`,
`db.inTransaction`, `db.lastInsertRowid`, `db.changes`.

## Prepared statements

`db.prepare(sql, schema)` validates bind parameters on write and row records on
read through `schema["~standard"].validate` (Standard Schema v1).
`db.prepareRaw(sql)` skips validation entirely. On `Stmt<TRow>`:

- `run(params)` / `runRaw` → `{ lastInsertRowid, changes }` for write SQL.
- `get(params)` → `TRow | undefined` (see subset quirk below), `getOrNull` →
  `TRow | null` — the subset-strict twin; prefer it in scriptc apps.
- `all(params)` / `allRaw` → `TRow[]`; `getRaw`/`allRaw`/`runRaw` skip
  validation on demand.
- Params bind by position (`[v1, v2]`) or by name (`{ title: "x" }`, also
  `":title"`, `"@title"`, `"$title"` — sigils interchangeable).
- `bind(params)` makes bindings permanent until the next bind/clear;
  `columns()` reports `sqlite3_column_*` metadata; `toString()` returns the
  expanded SQL; `finalize()` (or `using`/`Symbol.dispose`) releases it.

## Transactions

`db.transaction()` returns a `Transaction`; dispose commits unless the tx (or
any nested op) threw or was marked failed — then it rolls back. Nested
`db.transaction()` inside an open tx becomes an automatic savepoint;
`tx.savepoint(name)` gives an explicit one with `commit()`/`rollback()`.

## Errors

All SQLite failures throw `SqliteError` with `code` = the SQLite result name
(`"SQLITE_CONSTRAINT_NOTNULL"`, `"SQLITE_BUSY"`, ...) and `message` =
`sqlite3_errmsg` at throw time. Schema failures use code `"VALIDATION"`;
bind misuse `"BIND_PARAM"`; statement-busy `"STMT_BUSY"`.

## Binary size

Indicative `scriptc build` sizes for a scriptc app (your app's size varies —
no perf claims until the bench cell lands):

| Build                                           | Approx. added size |
| ----------------------------------------------- | ------------------ |
| `hello world` (scriptc only)                    | ~600 KB            |
| + `@cutils/sqlite` (`-O2`, amalgamation + shim) | ~1.6 MB            |

## Better-sqlite3 users: what changed

- Same shape: `prepare`/`run`/`get`/`all`, `transaction()`, `pragma`,
  positional + named params, `lastInsertRowid`/`changes`.
- `get()` returns `TRow | undefined` like better-sqlite3 — the one documented
  divergence from the cutils `| null` rule. `getOrNull()` is the `| null` twin.
- Validation is first-class: `prepare(sql, schema)` runs any Standard-Schema
  validator on params AND rows; `prepareRaw` is the fast path.
- Results are plain records; INTEGER columns return `number` when safe,
  `bigint` otherwise; BLOB returns `Uint8Array`; booleans bind as 0/1.
- No threads, no async, no `serialize`/`parallelize`, no extensions
  (`SQLITE_OMIT_LOAD_EXTENSION`), no user functions/aggregates — synchronous
  embedded SQL only.

## Node usage

The npm package ships `dist/esm`. Under Node the emitted `shim_*` calls resolve
on `globalThis` — an official [koffi](https://koffi.dev) binding loads
`build/libcutils_sqlite.so` for you:

```sh
# one-time, inside the installed package (needs a C toolchain):
npm run build:shared --prefix node_modules/@cutils/sqlite
```

```ts
import "koffi"; // ensure the optional peer is installed
import "@cutils/sqlite/node-binding"; // installs the shim_* globals
import { Database } from "@cutils/sqlite";
```

`koffi` is an **optional peer dependency** — install it when you run under
Node; scriptc builds never see it. The `.so` is linked `-Wl,-Bsymbolic` so the
vendored amalgamation's `sqlite3_*` symbols can't interpose against a host's
sqlite — this is load-bearing, Node ≥ 22 exports its own sqlite3 symbols.

Node ≥ 22 is the runtime floor; the test suite also runs there (no
`using`-syntax — dispose paths are exercised via `[Symbol.dispose]()`).

## Subset quirks

The package is authored in the [scriptc compilable subset](../../AGENTS.md):

- `get()` returning `| undefined` is the **only** `undefined` union in cutils —
  `getOrNull()` exists for subset-strict consumers. See
  `docs/subset-quirks.md`.
- `schema` params are Standard-Schema **classes**, not interfaces —
  interface-typed fields erase under the subset; the seam re-declares
  `~standard` as a `StdProps` class.

See `docs/integration.md`, `docs/schema.md`, `docs/subset-quirks.md`, and
`examples/todo-app/` for a worked chttp + sqlite app.
