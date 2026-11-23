---
"@cutils/sqlite": patch
---

fix(sqlite): @cutils/sqlite/node-binding works out of the box. The tarball ships prebuilt shared libraries for linux-x64, darwin-arm64 and darwin-x64, and falls back to compiling from the vendored sources (needs a C compiler); set CUTILS_SQLITE_LIB to override. No consumer-side build script needed.
