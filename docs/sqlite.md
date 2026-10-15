# @cutils/sqlite

Embedded SQLite for scriptc apps — the amalgamation vendored in-package, a
~34-entry C shim on the format-7 span FFI ABI, and a subset-clean
`Database` / `Stmt<TRow>` / `Transaction` wrapper with a Standard-Schema seam.
The same source runs under Node (shared-library build + koffi) and compiles
through `scriptc build` into a single static ELF — no sqlite at runtime.

```ts
import { Database } from "@cutils/sqlite";
import * as v from "@chttp/val";

const Todo = v.strictObject({ id: v.number(), title: v.string() });

const db = Database.open("app.db");
db.exec("CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");

const ins = db.prepare("INSERT INTO todos (title) VALUES (:title)", Todo);
ins.run({ title: "ship it" });

const sel = db.prepare("SELECT id, title FROM todos", Todo);
sel.getOrNull([1]); // TRow | null — subset-strict not-found
```

## Surface

| API | Notes |
| --- | --- |
| `Database.open(path, {readonly, fileMustExist})` / `openInMemory()` | file or `:memory:` |
| `db.exec(sql)` / `db.pragma(name)` | DDL + pragmas |
| `db.prepare(sql, schema)` / `prepareRaw(sql)` | Standard-Schema v1 seam, opt-out family |
| `stmt.run/runRaw` → `{lastInsertRowid, changes}` | write path, validates params first |
| `stmt.get` / `getOrNull` / `all` (+ `*Raw`) | read path, validates each row |
| `stmt.bind` / `columns()` / `toString()` | permanent binds, metadata, expanded SQL |
| `db.transaction()` / `tx.savepoint(name)` | auto-commit on dispose, auto-rollback on throw, nested → savepoint |
| `SqliteError` | `code` = SQLite result name (+ `"VALIDATION"`, `"BIND_PARAM"`, `"STMT_BUSY"`) |

## Params and values

Positional tuples or named records (sigils `:`/`@`/`$` interchangeable).
`number` binds INTEGER when safe-integer else REAL; `bigint` → INTEGER;
`boolean` → 0/1; `Uint8Array` → BLOB; `null`/`undefined` → NULL. INTEGER
columns read back as `number`, or `bigint` past the safe range.

## Docs in this package

- `packages/sqlite/docs/integration.md` — wiring into a chttp app,
  transactions, errors, bigint and parity notes.
- `packages/sqlite/docs/schema.md` — the Standard-Schema seam: val AND
  valibot examples, write + read validation, lenient inserts.
- `packages/sqlite/docs/subset-quirks.md` — the `get()`/`getOrNull` rule,
  `using` rules, the span FFI ABI, `-Wl,-Bsymbolic` for Node.
- `examples/todo-app/` — a runnable chttp + sqlite JSON API.
