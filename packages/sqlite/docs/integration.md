# Integrating @cutils/sqlite

Install it, vendor it, compile it. The package owns its native dependency —
nothing is fetched at build time.

```sh
pnpm add @cutils/sqlite
```

## The two runtimes

The same `src/` drives both modes:

- **Node** — `import { Database } from "@cutils/sqlite"` resolves to
  `dist/esm`. The emitted `shim_*` calls resolve on `globalThis`; install them
  from the shared build (`packages/sqlite/build/libcutils_sqlite.so`, via
  `pnpm build:shared`) — see `test/koffi-binding.mjs` for the koffi wiring.
- **ELF** — `scriptc build app.ts --ffi node_modules/@cutils/sqlite/vendor/manifest.json`
  links `vendor/.../libsqlite3-shim.a` statically. No sqlite at runtime.

## Opening

```ts
const db = Database.open("app.db");                    // file, created if absent
const mem = Database.openInMemory();                   // ":memory:"
const ro = Database.open("app.db", { readonly: true });
const must = Database.open("app.db", { fileMustExist: true });
```

`db.path`, `db.memory`, `db.readonly`, `db.inTransaction` are plain getters.
`close()` finalizes all tracked statements first; `using db = ...` does it
at scope end.

## Statements and `using`

```ts
const stmt = db.prepareRaw("INSERT INTO log (msg) VALUES (?)");
stmt.run(["a"]); stmt.run(["b"]);
stmt.finalize();
// or: using stmt = db.prepareRaw(...) — dispose finalizes
```

`run` returns `{ lastInsertRowid: number, changes: number }`. `get`/`all`
return plain records shaped by column names.

## Transactions

```ts
using tx = db.transaction();
db.exec("INSERT INTO t VALUES (1)");
{
  using inner = db.transaction();   // auto-SAVEPOINT inside the tx
  db.exec("INSERT INTO t VALUES (2)");
  inner.rollback();                  // rolls back to the savepoint
}
using sp = tx.savepoint("s1");       // explicit savepoint
db.exec("INSERT INTO t VALUES (3)");
sp.commit();                         // RELEASE
// tx commits here — any thrown error marks the tx failed and dispose rolls
// the whole transaction back.
```

## Params

Positional (`run([v1, v2])`) or named (`run({ title: "x" })` — also
`":title"`, `"@title"`, `"$title"`; sigils are interchangeable). Bind values:
`string`, `number` (safe-integer → INTEGER, else REAL), `bigint` → INTEGER,
`boolean` → 0/1, `Uint8Array` → BLOB, `null`/`undefined` → NULL. INTEGER
columns return `number` when the value fits a safe integer, else `bigint`.

## Errors

```ts
try {
  db.exec("INSERT INTO todos (title) VALUES (NULL)");
} catch (e) {
  if (e instanceof SqliteError) {
    e.code;    // "SQLITE_CONSTRAINT_NOTNULL"
    e.message; // sqlite3_errmsg text
  }
}
```

Codes are SQLite result names (extended codes where they exist:
`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_BUSY_SNAPSHOT`, ...), plus
`"VALIDATION"` (schema), `"BIND_PARAM"` (param misuse), `"STMT_BUSY"`.

## Bigint notes

`run` returns `lastInsertRowid`/`changes` as `number` — rowids under 2^53
cover every realistic database. INTEGER _columns_ return `bigint` when they
exceed the safe range, so `typeof row.n` can differ row to row; schema
validators that expect `number` will (correctly) reject a `bigint` read.

## DDL ↔ schema parity

`prepare(sql, schema)` validates what SQLite hands back — column names come
from `sqlite3_column_name`, so `SELECT title AS t` produces `{ t: ... }`.
Keep the schema's fields aligned with the projection, not the table. For
writes, the schema validates the bind record _before_ binding — extra keys
that match no named parameter are ignored, missing params go in as NULL
(unbound), and `undefined` values bind NULL too.

## Binary size

The amalgamation + shim add roughly 1.6 MB to a scriptc ELF at `-O2`. See the
package README for the indicative table; ship no perf claims until the
`bench/cells/db-elf.yml` cell exists.
