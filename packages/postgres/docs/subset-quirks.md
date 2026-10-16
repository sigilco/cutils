# Subset quirks

`@cutils/postgres` is authored in the scriptc compilable subset — the
shared rules live in the root `AGENTS.md`. This page collects where the
package's _surface_ bends for the subset, and what it means for your code.

## `Date` is not a `SqlValue`

The spec typed `SqlValue` with a `Date` arm. No union containing `Date`
lowers under scriptc 0.3.3 (SC2009 — there is no runtime narrowing test
that picks `Date` out of sibling arms), so v1 drops it:

- `timestamp`/`timestamptz` columns decode to **ISO-8601 UTC strings**
  (`"2026-10-15T12:30:00.500Z"`).
- Bind timestamps as ISO strings too — `d.toISOString()` at the call site.
- `new Date(v)` in user code recovers a `Date` whenever you want one.

`boolean` stays in the union (Postgres `bool` is real `t`/`f`), and
`int8` widens to `bigint` only past the safe-integer range.

## `get()` vs `getOrNull()`

`Stmt.get()` returns `TRow | undefined` for better-sqlite3 parity — the
**only** `| undefined` union in cutils (spec-mandated, fenced to this
method). In scriptc apps prefer `getOrNull()`: `TRow | null`, composes
with `=== null`, never grows an `undefined` union. `get()` is runtime-
identical to `getOrNull`; the difference is type-level only.

## TLS is `"disable"`-only

`tls.connect` is not lowered by scriptc (SC2020 — only `https.request`
is), so `ssl: "require"`/`"verify-full"` throw `PgError("0A000")` at
`connect`. The `SSLRequest` negotiation path exists but is unreachable.
Track scriptc changelogs; the option widens without an API change.

## One in-flight exchange per connection

`PgSocket` serializes work: each `exec`/`execute`/`prepare`/stmt call
takes the single-flight tail. Implications:

- `db.execute("SELECT pg_sleep(30)")` blocks every later call on that
  connection until it returns — including `prepare`. To cancel, keep a
  stmt handle from before the sleep and `db.cancel(stmt)` (fresh socket).
- Concurrent app work that must overlap needs another `Database.connect()`
  — or the pool sketch in `integration.md`.

## `toString()` and metadata

`stmt.toString()` returns the _source_ SQL (with your `:name` sigils), not
the `$N`-rewritten wire text — same as sqlite's `.source`. `columns()`
gives Postgres-specific metadata (`schema`, `table`, `type`, `notNull`,
`default`) resolved at prepare time through a best-effort `pg_catalog`
join; catalog failures degrade to `null` fields, never to a thrown
prepare.

## What the subset forbids here (and how it's handled)

- `Map`/`Set` for statement tracking → plain arrays with linear scans.
- `?.`/`??`/spread/method shorthand → explicit `=== null` checks and full
  literal shapes.
- `import type` of classes → `StandardSchemaV1`/`StdProps` are local
  classes; schema classes are value imports (SC2013).
- Non-program `instanceof` → schema conformance is `schema["~standard"]
.validate(value)`, never interface detection.
- `new Date(y, m, d, ...)` (unlowered) → `new Date(ms)` /
  `new Date(isoString)` in the timestamp codec.
- `String(union)` on unions containing `Uint8Array` → typeof-narrowing
  before conversion (`_loadCatalog`).
- `socket.write(data, cb)` → single-arg `write` (`cancel.ts`).
- Generic classes degrade → `interface Stmt<TRow> extends StmtCore` +
  `const Stmt = StmtCore`.
