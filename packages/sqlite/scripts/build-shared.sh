#!/bin/sh
# Build build/libcutils_sqlite.so, the koffi-loadable shared library, for the
# current platform. Used by test:node and by consumers running the package
# under Node.
#
# ELF (Linux): -Wl,-Bsymbolic is REQUIRED. Node >= 22 exports its own
# sqlite3_* symbols; without it the shim's internal calls interpose onto the
# host's build and every handle is a zombie -> SQLITE_MISUSE.
#
# Mach-O (macOS): the two-level namespace binds the shim's internal calls to
# this dylib's own sqlite3.o at link time, so no guard flag exists or is
# needed. -shared and -Wl,-Bsymbolic are GNU-ld spellings that ld64/ld-prime
# reject; -dynamiclib is the Mach-O equivalent.
#
# Usage: build-shared.sh [out-path]   (default build/libcutils_sqlite.so; pass an
# ABSOLUTE path, the script runs from the package root)
# Honors $CC (may carry flags, e.g. CC="cc -arch x86_64" to cross-build the
# macOS x64 library on an arm64 runner).
#
# Windows is out of scope here: the shared build needs a .dll from MSVC or
# zig cc, which the consumer-side Node path does not exercise yet.
set -eu
cd "$(dirname "$0")/.."

FLAGS="-O2 -fPIC -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_FTS5"
SRC="vendor/shim/sqlite_shim.c vendor/sqlite-amalgamation/sqlite3.c"
OUT="${1:-build/libcutils_sqlite.so}"
CC="${CC:-cc}"

mkdir -p "$(dirname "$OUT")"
case "$(uname -s)" in
  Darwin)
    $CC $FLAGS -dynamiclib $SRC -o "$OUT" -lm
    ;;
  Linux|*GNU*)
    $CC $FLAGS -Wl,-Bsymbolic -shared $SRC -o "$OUT" -lm
    ;;
  *)
    echo "build-shared: unsupported platform $(uname -s)" >&2
    exit 1
    ;;
esac
echo "built $OUT"
