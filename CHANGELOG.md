# Changelog

## Unreleased

<!-- release:start -->
## 0.4.0

### Breaking

- **@cutils/mongo:** **Breaking:** `BsonDate` drops its Date-producing methods (`toDate`/`toISOString`/`toString` — use `new Date(d.ms)`); `aggregate()` returns the concrete `AggregateCursorCore` — generic methods are signature-only through the Collection interface

### Features

- **@cutils/postgres:** Fix npm-consumer `scriptc build`: ship `./elf` export (dist JS compiled via `--npm-static`) plus JSDoc annotations the JS inference needs — definite field initializers, `import("./x.js").T` cross-file types, inline literal object types where `.d.ts` interfaces can't be named, `unknown[]` casts after `Array.isArray`, and a declared dictionary type for dynamic-key row writes. New `test/consumer-elf.test.sh` packs the tarball and builds a scratch app against it.
- **@cutils/sqlite:** Fix npm-consumer `scriptc build`: ship `./elf` export (dist JS compiled via `--npm-static`), a consumer-facing `ffi.json` manifest, and `elf/shims.d.ts` ambient declarations; replace the `Scratch` class with `ensure`/`copyOut` helpers and move stmt/tx tracking to a module-level registry so no class instance crosses a module boundary.

### Fixes

- **@cutils/mongo:** mongo: guard missing-key reads on typed records — scriptc throws 'record has no key' instead of yielding undefined
- **@cutils/mongo:** mongo: keep int64 cursor ids lossless — getMore/killCursors re-encode the raw bigint, fixing CursorNotFound on multi-batch cursors (#32)
- **@cutils/mongo:** mongo: insertOne builds the generated-_id document via toBsonDoc — direct tagged-literal store trips SC9001 under scriptc
- **@cutils/mongo:** mongo: omit startTransaction when false — mongod >=8 rejects the field outright
- **@cutils/mongo:** mongo: replace String.lastIndexOf in URI parsing — unsupported when the published dist is compiled by scriptc 0.3.4
<!-- release:end -->

## 0.3.0

### Features

- **@cutils/cache:** Rename @chttp/cache to @cutils/cache (scope correction; same code, same API).

## 0.2.0

### Features

- **@chttp/auth:** Add @chttp/auth: session, password, JWT, OAuth2+PKCE, CSRF and TOTP primitives over node:crypto
- **@cutils/mongo:** feat(mongo): hand-rolled async MongoDB wire driver (OP_MSG + BSON, no FFI)
- **@cutils/postgres:** New @cutils/postgres: hand-rolled async Postgres wire driver (node:net + node:crypto, Standard-Schema seam, SCRAM-SHA-256, NOTIFY, cancel)

### Fixes

- **@chttp/mcp, @cutils/sqlite:** Wire ELF smoke into pnpm test; resolve scriptc via workspace .bin instead of pnpm exec
- **@cutils/sqlite:** Fix empty string/blob binds landing as SQL NULL (empty span marshals as NULL pointer; shim substitutes a non-NULL literal)
- **@cutils/sqlite:** Ship ./node-binding subpath (official koffi loader) + optional koffi peer; tests run on Node 22 (no using-syntax)

## 0.1.0

### Features

- **@chttp/cache:** Initial release: Map-based LRU+TTL memory cache with lru-cache parity semantics — `get` bumps recency, `peek`/`has` do not, lazy TTL purge on access, LRU eviction past `max`. `Cache<V>` is a phantom-generic alias over `CacheCore` for scriptc compatibility; misses return `null`, `has()` disambiguates stored nulls.
- **@chttp/mcp:** Initial release: MCP server (JSON-RPC 2.0, spec 2025-06-18) in the scriptc subset — `Server` dispatcher over the full method table, `tool`/`resource`/`prompt` registration, Standard-Schema validation seam, injected `JsonSchemaEmitter`, auto-wrap ladder, `StreamableHttpTransport` with SSE `notifications/progress`.
- **@cutils/sqlite:** Initial release: embedded SQLite 3.50.4 (vendored amalgamation, public domain) behind a ~34-entry C FFI shim on the scriptc span ABI, with a subset-clean `Database` / `Stmt<TRow>` / `Transaction` / `SqliteError` TypeScript wrapper. `prepare(sql, schema)` runs any Standard-Schema v1 validator on bind params and result rows; the `*Raw` family opts out. Compiles into a single static ELF via `scriptc build --ffi vendor/manifest.json`; runs under plain Node through the shipped shared-library build + koffi.
