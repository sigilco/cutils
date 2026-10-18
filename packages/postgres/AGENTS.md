# @cutils/postgres AGENTS.md

Hand-rolled async Postgres wire driver in the scriptc subset: StartupMessage

- auth (cleartext / MD5 / SCRAM-SHA-256) + simple & extended query protocols
- DataRow decode + CancelRequest + LISTEN/NOTIFY drain, over `node:net` and
  `node:crypto` only. Same public skeleton as `@cutils/sqlite` (`Database` /
  `Stmt<TRow>` / `Transaction` / `PgError`), async variant — every method
  returns a Promise and every class `implements AsyncDisposable`.

## Commands

- `pnpm build` — `tsc` → `dist/esm`. No FFI, no vendor, no cc/ar/manifest.
- `pnpm test` — `node --test test/*.test.js test/*.test.mjs` (wire + scram
  vectors + coverage) then `bash test/elf.test.sh`. `test/pg.test.js` is
  the live-Postgres suite: skipped unless `PG_TEST_DSN` or `PG_TEST_PORT`
  is set (see test/pg.test.js header for the docker one-liner).
- `bash test/elf.test.sh` — compiles `gate.ts` to an ELF, runs it against
  `test/mock-server.mjs` over real TCP, expects `gate OK`. The TCP-from-ELF
  leg is the point: it proves `node:net` + `node:crypto` lower.
- `scriptc coverage gate.ts` — must report 100% static.
- `bash test/consumer-elf.test.sh` — packs the tarball, installs it into a
  scratch app under `build/consumer-smoke/`, compiles `gate.ts` against
  `@cutils/postgres/elf` with `--npm-static`, runs the ELF vs the mock
  server. Any break there is a packaging regression, not a subset failure.

## Consumer compile contract (`--npm-static`)

- `./elf` (→ `./dist/esm/index.js`) is the consumer entry. scriptc's
  `--npm-static` compiles the shipped JS with inference: export conditions
  and `.ts` targets resolve to nothing for it, so `./elf` stays a plain
  string and the bare `@cutils/postgres` import is workspace-only.
- The `.d.ts` surface is hidden in that mode — types the JS cannot infer
  must come from JSDoc that survives `tsc` into `dist/esm`:
  - `@param`/`@returns` on every public/internal signature whose params
    would infer `unknown` (unknown-instantiated calls defer to runtime
    fences — SC2020 sites that only fire when reached).
  - Cross-file class types use `import("./socket.js").PgSocket` — type-only
    imports are erased at runtime so they cost nothing.
  - Interfaces/type aliases can't be named (no `.d.ts`) — spell them as
    inline literal object types in the JSDoc (see `rowFromValues`' cols).
  - JS field decls without initializers infer `T | undefined` — initialize
    class fields inline (see `PgSocket._tail`).
  - `Array.isArray` narrows to `any[]`, which scriptc won't lower — cast
    with `/** @type {unknown[]} */` (see `_encodeParams`).
  - Dictionary writes need a declared record: `const row: Rec = /** @type
{Record<string, unknown>} */ ({});` (see `rowFromValues`).

## Layout

- `src/index.ts` — `Database`, `StmtCore` (+ `interface Stmt<TRow>`),
  `Transaction`, re-exports. Public surface is the spec's ~17 methods +
  `execute`/`notify`/`cancel`/`serverVersion` add-ons; nothing else.
- `src/types.ts` — `SqlValue`, `BindValue`, `Row`, `ConnectOpts`,
  `ColumnInfo`, `NotifyEvent`, local `StandardSchemaV1`/`StdProps` twins.
- `src/errors.ts` — `PgError` (`code` = SQLSTATE).
- `src/validate.ts` — async Standard-Schema seam.
- `src/internal/buffer.ts` — Writer/Msg/Reader: frame codec + TCP de-framer.
- `src/internal/messages.ts` — message encoders/decoders + `scanParams`
  (`:x`/`@x`/`$x` → `$N` rewrite).
- `src/internal/socket.ts` — `PgSocket` (single-flight `run(exchange)`,
  socket-side dispatch of notify/paramstatus/notices/backend-key) +
  `Exchange` (sentinel-waiter message pump).
- `src/internal/auth.ts` — `Scram` (RFC 5802/7677) + `authenticate` loop.
- `src/internal/simple.ts` / `extended.ts` — 'Q' path and
  Parse/Bind/Describe/Execute/Sync + Close 'S' (server-side DEALLOCATE).
- `src/internal/rows.ts` — text-format DataRow codec, OID → `SqlValue`.
- `src/internal/oids.ts` — OID constants + numeric-OID table.
- `src/internal/cancel.ts` — CancelRequest on a fresh socket.
- `src/internal/notify.ts` — `NOTIFY "ch", 'payload'` quoting.
- `src/internal/tls.ts` — `assertSslSupported`: `ssl != "disable"` throws
  `PgError 0A000` — **`tls.connect` is not lowered by scriptc 0.3.3**
  (SC2020); only `https.request` is. TLS lands when scriptc lowers it.
- `test/mock-server.mjs` — canned wire server (plain Node, not subset).
  Powers wire tests + the ELF smoke; auth scripted via `createMockServer`.

## Package-specific subset rules

Beyond the root rules:

- **`Date` is banned inside unions** — no union with a `Date` arm lowers
  (SC2009: no runtime narrowing against sibling arms). `SqlValue` therefore
  drops the spec's `Date` arm: timestamps round-trip as ISO-8601 UTC
  strings, binds take the same strings. Documented in
  `docs/subset-quirks.md`; do not re-add `Date` to `SqlValue`/`BindValue`.
- **`tls.connect` is not lowered** — all non-`"disable"` `ssl` modes throw
  `0A000` at `Database.connect` (deviation from spec; tracked in
  `docs/integration.md`).
- **`new Date(...)` is restricted** — `new Date(ms)` and `new Date(string)`
  - `toISOString()` lower; the multi-arg form does not. Timestamp parse
    lives in `rows.ts:parseTimestamp`.
- **`String(union)` needs narrowing** — `String(v)` where `v` is a union
  containing `Uint8Array` is SC1090; typeof-narrow first (see
  `_loadCatalog`).
- **`write(data, cb)` is not lowered** — `net.Socket.write` is single-arg
  (`cancel.ts`).
- **Generic classes degrade** — `Stmt` is `interface Stmt<TRow> extends
StmtCore` + `const Stmt = StmtCore`, same as sqlite.
- **`get() | undefined`** — the one sanctioned `| undefined` divergence,
  spec-mandated, with `getOrNull` as the subset-strict twin.
- Schema classes (`StandardSchemaV1`) are VALUE imports — `import type`
  erases their lowering (SC2013).

## Tests

- `test/wire.test.js` — MockSocket-level codec tests + canned-server round
  trips over real TCP (no Postgres needed).
- `test/scram.test.js` — RFC 7677 vectors + nonce/signature failure paths.
- `test/pg.test.js` — live Postgres, gated on `PG_TEST_DSN`/`PG_TEST_PORT`.
- `test/coverage.test.mjs` — `scriptc coverage gate.ts` = 100%.
- `test/elf.test.sh` — ELF smoke against `test/mock-server.mjs`.
