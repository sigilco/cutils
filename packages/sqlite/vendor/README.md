# vendor/

Vendored native dependencies for `@cutils/sqlite`. Everything under this
directory is compiled into the consumer's binary by `scriptc build --ffi`;
nothing here is a runtime dependency.

## sqlite-amalgamation/

The SQLite amalgamation (`sqlite3.c` + `sqlite3.h`), vendored unmodified from
upstream. SQLite is dedicated to the public domain
(<https://www.sqlite.org/copyright.html>), so redistribution inside this package
needs no license attribution.

- Version: **3.50.4** (see `SQLITE_VERSION`; `SQLITE_VERSION_NUMBER` 3500400)
- Source: <https://www.sqlite.org/2025/sqlite-amalgamation-3500400.zip>
- Downloaded: 2026-10-15

SHA-256 checksums (verify with `sha256sum`):

```
e3f5d6901e7492af4a1fc8c4d745cae84c264942524c3fbfc02b82a5ca8818c8  sqlite3.c
abd1514e0351f79393d1be882830afdb40a8099e8257f311f0bfdf8486f11bea  sqlite3.h
```

If these checksums ever differ, the files were modified or corrupted — do not
ship them; re-vendor from upstream instead.

Compiled with `-O2 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION
-DSQLITE_ENABLE_COLUMN_METADATA`:

- `SQLITE_THREADSAFE=0` — single-connection, single-threaded model; matches the
  wrapper's `Database` (one handle per instance).
- `SQLITE_OMIT_LOAD_EXTENSION` — no `load_extension`; removes attack surface.
- `SQLITE_ENABLE_COLUMN_METADATA` — enables `sqlite3_column_table_name` /
  `column_database_name` / `column_origin_name` for `Stmt.columns()`.

## shim/

`sqlite_shim.c` — the thin C shim (~300 LoC) that adapts the SQLite C API to
scriptc's FFI ABI (fixed-width signatures, `mutable-bytes` out params). This is
the only C code maintained in this package; the amalgamation is upstream,
unmodified.

## manifest.json

The scriptc FFI manifest (`ffi_format: 7`) consumed by
`scriptc build --ffi` and `scriptc coverage --ffi`. `libraries` points at the
prebuilt archive `../build/libsqlite3-shim.a` produced by `pnpm build`.
