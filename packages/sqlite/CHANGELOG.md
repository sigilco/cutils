# @cutils/sqlite

## 0.1.0

### Minor Changes

- Initial release: embedded SQLite 3.50.4 (vendored amalgamation, public
  domain) behind a ~34-entry C FFI shim on the scriptc span ABI, with a
  subset-clean `Database` / `Stmt<TRow>` / `Transaction` / `SqliteError`
  TypeScript wrapper. `prepare(sql, schema)` runs any Standard-Schema v1
  validator on bind params and result rows; the `*Raw` family opts out.
  Compiles into a single static ELF via `scriptc build --ffi
vendor/manifest.json`; runs under plain Node through the shipped
  shared-library build + koffi.
