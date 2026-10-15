# @cutils/postgres

Async Postgres wire driver for scriptc: the PostgreSQL frontend/backend
protocol (v3) hand-rolled over `node:net` + `node:crypto` — StartupMessage,
cleartext/MD5/SCRAM-SHA-256 auth, simple and extended query protocols,
text-format row decode, CancelRequest, and a LISTEN/NOTIFY drain — wrapped
in the same `Database` / `Stmt<TRow>` / `Transaction` / `PgError` skeleton
as `@cutils/sqlite`, async. The same source runs under plain Node and
compiles through `scriptc build` into a single static ELF — no `pg`,
`postgres.js`, or native driver anywhere.

```ts
import { Database } from "@cutils/postgres";
import * as v from "@chttp/val";

const Todo = v.object({
  id: v.number(),
  title: v.string(),
  done: v.boolean(),
});

const db = await Database.connect({
  host: "127.0.0.1",
  port: 5432,
  user: "app",
  password: "secret",
  database: "appdb",
});

// Validating statements: write params and row records are checked through
// schema["~standard"].validate — any Standard-Schema v1 library works.
const ins = await db.prepare(
  "INSERT INTO todos (title, done) VALUES (:title, :done)",
  Todo,
);
await ins.run({ title: "ship it", done: false });

const one = await db.prepare(
  "SELECT id, title, done FROM todos WHERE id = $1",
  Todo,
);
const row = await one.getOrNull([1]); // TRow | null

await using tx = await db.transaction(); // auto-commit on dispose
await tx.exec("INSERT INTO todos (title) VALUES ('in tx')");

const raw = await db.prepareRaw("SELECT count(*) AS n FROM todos");
const { n } = await raw.getOrNull([]);

await db.close();
```

## Connecting

```ts
await Database.connect({
  host, port = 5432, user, password, database,
  applicationName, connectTimeoutMs, statementTimeoutMs,
  ssl: "disable" | "require" | "verify-full",
})
```

`ssl` accepts only `"disable"` in v1: `tls.connect` is not yet lowered by
scriptc (SC2020), so `"require"`/`"verify-full"` throw
`PgError("0A000")` at connect — put TLS in front with `pgbouncer`/`stunnel`
or a private network. Getters: `db.host`, `db.port`, `db.database`,
`db.user`, `db.backendPid`, `db.backendSecret`, `db.serverVersion`,
`db.inTransaction`.

## Surface

| API                                                     | Notes                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `db.exec(sql)` / `execRaw(sql)`                         | DDL/multi-statement 'Q' path                                                 |
| `db.execute(sql, args?)`                                | one-shot unnamed extended path (no stmt cache)                               |
| `db.pragma(sql)`                                        | `SHOW`/`SET`-friendly `{rows, rowCount}` shortcut                            |
| `db.prepare(sql, schema)` / `prepareRaw(sql)`           | Standard-Schema v1 seam + opt-out                                            |
| `stmt.run/runRaw` → `{rowCount}`                        | validates params first (record binds)                                        |
| `stmt.get/getOrNull/getRaw/all/allRaw`                  | validates each row (`get` returns `undefined`)                               |
| `stmt.bind` / `columns()` / `toString()` / `finalize()` | permanent binds, pg catalog metadata, source                                 |
| `db.transaction()` / `tx.savepoint(name)`               | `await using`; nested → savepoint; failed tx auto-rolls back on dispose      |
| `db.notify(channel, payload)`                           | `NOTIFY` + drains any pending notifications → `{received}`                   |
| `db.cancel(stmt)`                                       | CancelRequest on a fresh socket for that stmt's connection                   |
| `db.serverVersion`                                      | `server_version` ParameterStatus                                             |
| `db.lastInsertRowid()` / `db.changes()`                 | always throw `0A000` — Postgres has no rowid/`changes()`                     |
| `PgError`                                               | `code` = SQLSTATE (e.g. `23505`), plus `severity`/`detail`/`hint`/`position` |

## Params and values

Positional tuples (`$1`, `$2`, …) or named records (`:x`, `@x`, `$x`
sigils are interchangeable — the driver rewrites them to `$N`, skipping
literals, comments, `::` casts, and dollar-quoted bodies).

`number`/`bigint`/`string`/`boolean`/`Uint8Array`/`null` bind as text.
`int8` reads back `number`, or `bigint` past the safe range; `bool` →
`boolean`; `bytea` → `Uint8Array`; `timestamp`/`timestamptz` → **ISO-8601
UTC strings** (v1: `Date` cannot sit in a scriptc-compiled union — bind
timestamps as ISO strings too); `date`/`numeric`/`json`/`uuid`/unknown
OIDs → raw text.

## PerryTS/postgres users: what changed

The wire layer borrows its shape from `PerryTS/postgres` (MIT, skelpo) —
the implementation is original. If you used that driver:

- `new Client({...})` → `await Database.connect({...})`; auth is still
  SCRAM-SHA-256 + MD5 + cleartext.
- `client.query(sql, args)` → `db.execute(sql, args)` (no cache) or
  `await db.prepare(sql)` + `stmt.all/getOrNull` (server-prepared).
- Rows are records of `SqlValue` — optionally validated per-row through a
  Standard-Schema v1 validator (`prepare(sql, schema)`), which PerryTS
  never had. `*Raw` skips it.
- `pool`/`Client` lifecycle → `await using` + `[Symbol.asyncDispose]()`;
  there is no `Pool` class in v1 — hold connections yourself (a ~15-line
  example lives in `docs/integration.md`).
- LISTEN/NOTIFY is a drain (`db.notify` returns `{received}`), not a
  long-lived consumer.
- Timestamps are ISO strings, not `Date` (scriptc union limitation).
- TLS is `"disable"`-only for now — `tls.connect` isn't lowered yet.

`node-postgres` (`pg`) users: no `Pool`, no `client.query` promise API,
no COPY, no SSL — by design; the entire surface is ~17 methods.

## Docs in this package

- `docs/integration.md` — connection lifecycle, transactions, errors,
  cancel/notify semantics, TLS status, a subset-clean pool sketch.
- `docs/auth.md` — cleartext / MD5 / SCRAM-SHA-256 details and limits.
- `docs/schema.md` — the Standard-Schema seam: `@chttp/val` AND valibot
  examples, lenient inserts, `*Raw` escape hatch.
- `docs/subset-quirks.md` — `get()`/`getOrNull`, `Date`-free unions, TLS,
  `toString`, single-flight semantics.
- `examples/todo-app-postgres/` — a runnable chttp + postgres JSON API.
