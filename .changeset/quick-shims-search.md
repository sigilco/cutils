---
"@cutils/sqlite": minor
---

Build SQLite with FTS5 and ship `scripts/build-shim.mjs` to build the shim archive plus a matching ffi manifest for any target (macOS, Windows, cross-compiles via `zig cc`); the tarball archive is Linux-only.
