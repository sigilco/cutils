# @cutils/sqlite

## 0.2.0

### Patch Changes

- Fix empty string/blob binds landing as SQL NULL (empty span marshals as NULL pointer; shim substitutes a non-NULL literal)

- Ship ./node-binding subpath (official koffi loader) + optional koffi peer; tests run on Node 22 (no using-syntax)

- Wire ELF smoke into pnpm test; resolve scriptc via workspace .bin instead of pnpm exec

## 0.1.0

### Minor Changes

- Initial release: embedded SQLite 3.50.4 (vendored amalgamation, public domain) behind a ~34-entry C FFI shim on the scriptc span ABI, with a subset-clean `Database` / `Stmt<TRow>` / `Transaction` / `SqliteError` TypeScript wrapper. `prepare(sql, schema)` runs any Standard-Schema v1 validator on bind params and result rows; the `*Raw` family opts out. Compiles into a single static ELF via `scriptc build --ffi vendor/manifest.json`; runs under plain Node through the shipped shared-library build + koffi.
