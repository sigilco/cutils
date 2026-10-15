# @cutils/postgres

Async Postgres wire driver for scriptc — the frontend/backend protocol
hand-rolled over `node:net` + `node:crypto` (StartupMessage, cleartext/MD5/
SCRAM-SHA-256 auth, simple + extended queries, CancelRequest, NOTIFY
drain), wrapped in the same `Database` / `Stmt<TRow>` / `Transaction` /
`PgError` skeleton as `@cutils/sqlite`. No `pg`, no `postgres.js`, no
native dependency — it compiles into the same static ELF as your app.

```ts
import { Database } from "@cutils/postgres";

const db = await Database.connect({
  host: "127.0.0.1",
  port: 5432,
  user: "app",
  password: "secret",
  database: "appdb",
});

const ins = await db.prepare(
  "INSERT INTO todos (title, done) VALUES (:title, :done)",
  TodoSchema, // any Standard-Schema v1 validator
);
await ins.run({ title: "ship it", done: false });

const one = await db.prepare("SELECT id, title, done FROM todos WHERE id = $1", TodoSchema);
const row = await one.getOrNull([1]);

await db.close();
```

## Surface

| API | Notes |
| --- | --- |
| `db.exec` / `execRaw` | simple 'Q' path (DDL, scripts) |
| `db.execute(sql, args?)` | one-shot unnamed extended path |
| `db.pragma(sql)` | `SHOW`/admin shortcut → `{rows, rowCount}` |
| `db.prepare` / `prepareRaw` | server-prepared + Standard-Schema seam |
| `stmt.run` → `{rowCount}`; `get`/`getOrNull`/`all` (+`Raw`) | validates binds + rows |
| `stmt.bind` / `columns()` / `finalize()` | permanent binds, pg catalog metadata |
| `db.transaction()` / `tx.savepoint()` | `await using`; nested → savepoint |
| `db.notify(ch, payload)` | `NOTIFY` + drain → `{received}` |
| `db.cancel(stmt)` | CancelRequest on a fresh socket |
| `PgError` | `code` = SQLSTATE |

## Values

Named (`:x`/`@x`/`$x`, rewritten to `$N`) or positional binds.
`bool` → `boolean`, `int8` → `number`/`bigint`, `bytea` → `Uint8Array`,
timestamps → ISO-8601 strings (no `Date` in the compiled union), other
OIDs → raw text.

## v1 limits

`ssl` is `"disable"`-only (`tls.connect` isn't lowered yet — `"require"`
throws `0A000`); no `Pool` class; no COPY; `lastInsertRowid`/`changes`
throw `0A000`; one in-flight exchange per connection.

## Docs in this package

- [`packages/postgres/docs/integration.md`](https://github.com/sigilco/cutils/tree/main/packages/postgres/docs/integration.md) — lifecycle, transactions, TLS status, pool sketch
- [`packages/postgres/docs/auth.md`](https://github.com/sigilco/cutils/tree/main/packages/postgres/docs/auth.md) — cleartext/MD5/SCRAM-SHA-256
- [`packages/postgres/docs/schema.md`](https://github.com/sigilco/cutils/tree/main/packages/postgres/docs/schema.md) — Standard-Schema seam (val + valibot)
- [`packages/postgres/docs/subset-quirks.md`](https://github.com/sigilco/cutils/tree/main/packages/postgres/docs/subset-quirks.md) — `get()`/`getOrNull`, `Date`-free unions, single-flight
- `examples/todo-app-postgres/` — runnable chttp + postgres API
