# cutils architecture

cutils hosts the utility packages of the chttp/scriptc ecosystem. Two scopes, one contract: the package's TypeScript stays inside the scriptc-compilable subset so `scriptc build` statically lowers package and app together into a single native ELF — no runtime dependencies, no N-API, no Node addon.

## Scopes

- **`@cutils/*`** — general-purpose utilities that own their own C dependency and ship it behind an FFI shim (`@cutils/sqlite`; the pattern for the DB family, `@cutils/postgres`/`@cutils/mongo` later). The C library is vendored, the shim is ~26 fixed signatures, and the TypeScript wrapper is the only user-facing surface.
- **`@chttp/*`** — request-scoped utilities that are a web-server concern (`@chttp/cache`, `@chttp/mcp`). Pure TypeScript over the same subset, no C.

## The Standard-Schema seam

Wherever a package accepts user-typed data — SQLite row shapes, MCP tool arguments — the contract is Standard Schema v1 (`@standard-schema/spec`, type-only): the user hands any conforming validator to a registration call (`prepare(sql, schema)`, `tool(name, schema, handler)`), validation runs via `schema["~standard"].validate`, and `StandardSchemaV1.InferOutput<S>` types the result. JSON-Schema emission, when a protocol needs it, is an injected `JsonSchemaEmitter` — the packages ship zero emitters and zero validator dependencies. `@chttp/val` and valibot are dev-deps for seam-proof tests only.

## Subset rationale

The subset is what makes `scriptc build` able to lower program code into a static binary. The load-bearing rules (full list in `AGENTS.md`):

- **`| null` unions only** — `| undefined` refuses (SC3004). Misses return `null`; `has()`/explicit sentinels disambiguate. `@cutils/sqlite.get()` is the single documented exception (`| undefined`, matching better-sqlite3) with `getOrNull()` as the subset-strict twin.
- **No generics on classes, no class unions** — scriptc 0.3.x lowers generic class instances and `A | B` class unions to methodless shells. Narrow to `*Core` non-generic classes plus type-level aliases; use `T | null` and wrap-at-callsite adapters instead of union parameters.
- **Records can't hold functions** — function-typed record fields degrade instantiation to `unknown`. Callbacks live in parallel arrays on the owning class; registrations store indices.
- **No ambient `Map`/`Set`** — banned by default; a package may lift a specific container when a probe verifies it (0.3.3 lifted `Map`/`Set` for `@chttp/cache`'s LRU).
- **FFI is executable-only** — `declare function` + a JSON manifest + object files/archives on `scriptc build --ffi`. The shim is stateless, every signature is fixed-width (`i64`, `f64`, `cstring`, `mutable-bytes` out-params), and text/blob/errmsg flow through caller-owned buffers.

## Gates

Every package has: unit tests under Node (`node --test`), a `packages/*/gate.ts` compile gate that must report `compile statically (100%)` under `scriptc coverage`, and `test/elf.test.sh` — an end-to-end `scriptc build` + run smoke that catches the lowering failures static coverage defers to runtime. CI runs all three (`ci.yml` `test` + `scriptc-coverage` jobs).
