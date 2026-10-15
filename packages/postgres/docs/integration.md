# Integration

Wiring `@cutils/postgres` into a chttp/scriptc app.

## Connect and dispose

`Database.connect` performs the startup handshake, authenticates
(cleartext → MD5 → SCRAM-SHA-256, whichever the server asks for), and
drains until the first `ReadyForQuery`. The connection is one socket,
one in-flight exchange at a time — the driver serializes statements
internally, so you never wait on a busy connection yourself.

```ts
await using db = await Database.connect({
  host: "127.0.0.1",
  port: 5432,
  user: "app",
  password: "secret",
  database: "appdb",
  applicationName: "my-svc",
  connectTimeoutMs: 5000,
  statementTimeoutMs: 30000, // issued as SET statement_timeout post-auth
});
// socket + every prepared statement cleaned up on scope exit
```

`connectTimeoutMs` bounds the TCP connect only; auth follows the socket's
natural pacing. `db.close()` sends `Terminate` then destroys the socket;
`[Symbol.asyncDispose]()` is `close()`.

## TLS status (v1)

`ssl` accepts only `"disable"`. `tls.connect` is not lowered by scriptc
0.3.3 — `"require"` and `"verify-full"` throw `PgError("0A000")` during
connect, and the SSL negotiation code (`SSLRequest` → `'S'` upgrade) is
written but unreachable. For production put TLS in front via `pgbouncer`
(transaction pooling), `stunnel`, or a private network — the driver then
sees a plain TCP endpoint.

## Which path for which statement

| Call                        | Wire path                                 | Use for                                                   |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `db.exec` / `execRaw`       | simple 'Q'                                | DDL, multi-statement scripts, `BEGIN`/`COMMIT` (internal) |
| `db.execute(sql, args)`     | unnamed extended                          | one-shots, `SET`/`SHOW`, ad-hoc                           |
| `db.pragma(sql)`            | simple 'Q' returning rows                 | `SHOW`, admin queries                                     |
| `db.prepare` / `prepareRaw` | named extended (Parse+Describe+Sync once) | hot paths, validated rows                                 |

Prepared statements live server-side until `finalize()` (Close 'S' /
DEALLOCATE) or `db.close()`.

## Transactions

`await db.transaction()` issues `BEGIN`; disposing an `await using`
transaction commits, or rolls back when the transaction entered the
failed state (`E`) — Postgres itself refuses `COMMIT` there, so
`PgError` propagating out of `tx.exec` marks it. Nested
`await tx.savepoint(name)` gives `SAVEPOINT`/`RELEASE`/`ROLLBACK TO`
with the same dispose semantics.

```ts
await using tx = await db.transaction();
await tx.exec("UPDATE accounts SET balance = balance - 100 WHERE id = 1");
const inner = await tx.savepoint("half");
try {
  await inner.exec("UPDATE accounts SET balance = balance + 100 WHERE id = 2");
  await inner.commit(); // RELEASE
} catch (e) {
  await inner.rollback(); // ROLLBACK TO + RELEASE
}
await tx.commit();
```

## Errors

Every server `ErrorResponse` becomes `PgError` — `code` is the SQLSTATE
(`42601`, `23505`, `57014`, …) with `severity`/`detail`/`hint`/`position`
mapped when the server sends them. Driver-originated failures reuse the
same class: `"VALIDATION"` (schema), `"CONNECTION"` (socket/startup),
`"0A000"` (unsupported: rowid, `changes()`, TLS modes, COPY subprotocols).

## Notify and cancel

`db.notify(channel, payload)` issues `NOTIFY "ch", 'payload'` and returns
`{received}` — every `NotificationResponse` drained while your query was
in flight (LISTEN registrations are plain `exec("LISTEN ch")`). There is
no long-lived consumer in v1: notifications only surface when you ask the
socket for work.

`db.cancel(stmt)` opens a fresh TCP connection, sends the 16-byte
CancelRequest (`pid` + `secret` learned at startup), and closes. Postgres
aborts whatever that connection is running with `PgError 57014`. Build
the stmt before launching the slow query — everything on a connection is
single-flight, so a statement you try to prepare _during_ `pg_sleep`
queues behind the sleep.

## User-side pooling (subset-clean sketch)

No `Pool` class ships in v1. A pool for a chttp app is ~15 lines and must
itself be subset-clean (it compiles into your ELF):

```ts
const free: Database[] = [];
async function borrow(): Promise<Database> {
  if (free.length > 0) return free.pop();
  return Database.connect(opts);
}
function giveBack(db: Database): void {
  free.push(db);
}
// on app shutdown: for each free db, await db.close()
```

Invalidate on `PgError` with `code` `"CONNECTION"`/`"08*"` class codes —
`close()` the handle instead of returning it.
