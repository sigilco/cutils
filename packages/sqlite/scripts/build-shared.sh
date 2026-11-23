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
# Windows is out of scope here: the shared build needs a .dll from MSVC or
# zig cc, which the consumer-side Node path does not exercise yet.
set -eu
cd "$(dirname "$0")/.."

FLAGS="-O2 -fPIC -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_FTS5"
SRC="vendor/shim/sqlite_shim.c vendor/sqlite-amalgamation/sqlite3.c"
OUT=build/libcutils_sqlite.so

mkdir -p build
case "$(uname -s)" in
  Darwin)
    cc $FLAGS -dynamiclib $SRC -o "$OUT" -lm
    ;;
  Linux|*GNU*)
    cc $FLAGS -Wl,-Bsymbolic -shared $SRC -o "$OUT" -lm
    ;;
  *)
    echo "build-shared: unsupported platform $(uname -s)" >&2
    exit 1
    ;;
esac
echo "built $OUT"
