# @cutils/sqlite AGENTS.md

Embedded SQLite inside the scriptc subset: vendored amalgamation + C shim +
TS wrapper. Models on `@chttp/val` for packaging; the FFI layer follows
`chttp/docs/native.md` (format-7 manifest, span ABI).

## Commands

- `pnpm build` — C shim object, amalgamation object, `ar` archive
  `build/libsqlite3-shim.a`, `tsc` → `dist/`
- `pnpm build:shared` — `build/libcutils_sqlite.so` for the Node/koffi tests
  (**must** keep `-Wl,-Bsymbolic`: Node ≥ 22 exports its own `sqlite3_*`
  symbols; without it the shim's internal sqlite calls interpose onto the
  host's build and every handle is a zombie → SQLITE_MISUSE)
- `pnpm test` — `test:c` (C assertions over the archive), `test:node`
  (wrapper through koffi), `coverage.test.mjs` (scriptc coverage of gate.ts)
- `bash test/elf.test.sh` — compiles `gate.ts` to an ELF with
  `--ffi gate.ffi.json`, runs it, expects `gate OK`

## Layout

- `vendor/sqlite-amalgamation/` — sqlite3.c/h 3.50.4 (public domain),
  checksums + provenance in `vendor/README.md`. Re-vendoring = update both +
  `SQLITE_VERSION` constant in `src/index.ts` if we pin it.
- `vendor/shim/sqlite_shim.c` — ~34 `shim_*` entry points. **Span ABI**:
  every `string`/`bytes` param is `(const uint8_t *data, size_t len)` — NOT
  NUL-terminated; `mutable-bytes` out params are `(uint8_t *buf, size_t len)`.
  Buffer-out convention: return `>= 0` required bytes (grow & retry when it
  exceeds `buf`), `-1` for SQL NULL. `shim_step` returns 0=ROW, 101=DONE,
  else the sqlite rc.
- `vendor/manifest.json` — `ffi_format: 7`, one entry per shim function;
  `gate.ffi.json` is a generated copy with `libraries` pointing at the
  archive (regenerate: `node -e` copy or keep in sync by hand — the two
  MUST match or `scriptc coverage` / `--ffi` builds diverge).
- `src/internal/ffi.ts` — `declare function` block matching the manifest
  exactly (names, arity). Under Node the emitted calls hit globals;
  `test/koffi-binding.mjs` installs them.
- `src/` — `Database`, `StmtCore` (+ `interface Stmt<TRow>`), `Transaction`,
  `SqliteError`, `validate.ts` (Standard-Schema seam), `types.ts`.

## Package-specific subset rules

Beyond the root rules:

- **Schema seam is classes, not interfaces** (`StdProps` / `StandardSchemaV1`
  in `types.ts`): interface-typed class fields erase to `unknown` (SC1090)
  and `import type` of a class erases its runtime lowering (SC2013) — schema
  classes are VALUE imports, `GateSchema extends StandardSchemaV1` and swaps
  `this["~standard"]` in the constructor (field re-declaration at a narrower
  type is SC1090).
- `Stmt.get()` returning `| undefined` is the ONE sanctioned `undefined`
  union in the repo (spec-mandated better-sqlite3 parity); `getOrNull()` is
  the subset-strict twin. Do not add more `undefined` unions.
- Generic classes degrade to methodless shells → `StmtCore` is concrete;
  `interface Stmt<TRow> extends StmtCore` carries the generics;
  `export const Stmt = StmtCore`.
- `using` only inside functions/blocks (top-level `using` is SC1090) and
  never on an interface-typed value — `Stmt` vars use explicit `finalize()`.
- `stmt.bind()` semantics: `run/get/all` with an EMPTY or omitted params arg
  reuses current bindings; a non-empty arg resets bindings first.
- Out-params copy through `internal/buffer.ts`'s `Scratch` (doubles until the
  shim reports required bytes ≤ capacity).

## Tests

- `test/shim.test.c` asserts the shim at C level against the archive —
  span literals use the `SL(x)` macro (`ptr, strlen`); hardcode no lengths.
- `test/wrapper.test.js` runs the tsc build under plain Node via
  `test/koffi-binding.mjs`; the same fixtures must exercise the schema seam
  through **both** `@chttp/val` and valibot (any Standard-Schema validator
  must work — never special-case one).
- `coverage.test.mjs` shells `scriptc coverage gate.ts --ffi gate.ffi.json`
  and asserts 100%.
- `test/elf.test.sh` compiles + runs gate.ts as an ELF — the true smoke that
  the span ABI, archive linking, and wrapper all agree.

## Pitfalls (verified)

- `sqlite3_errcode` returns the PRIMARY code; `shim_errcode` uses
  `sqlite3_extended_errcode` so `SQLITE_CONSTRAINT_*` sub-codes survive.
- TEXT column affinity coerces inserted numbers to TEXT — a read-side
  validation failure needs a `CAST`/expression column, not a stored 123.
- `gate.ffi.json` drifting from `vendor/manifest.json` produces SC5003
  arity errors — regenerate on every manifest edit.
