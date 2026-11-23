#!/bin/sh
# Build the koffi-loadable shared library for the current platform. Used by
# test:node, by consumers running the package under Node, and by
# scripts/build-prebuilt.mjs for the release matrix.
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
# PE (Windows, *.dll out): -shared with a mingw-style toolchain (zig cc
# -target *-windows-gnu, or a native mingw gcc). No -fPIC (meaningless), no
# -Bsymbolic (PE binds intra-DLL calls directly, so the ELF interposition
# bug cannot happen), no -lm.
#
# Usage: build-shared.sh [out-path]   (default build/libcutils_sqlite.so; pass an
# ABSOLUTE path, the script runs from the package root)
# Honors $CC (may carry flags, e.g. CC="cc -arch x86_64" to cross-build the
# macOS x64 library on an arm64 runner, or CC="zig cc -target x86_64-windows-gnu"
# for a Windows DLL).
set -eu
cd "$(dirname "$0")/.."

BASE="-O2 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_FTS5"
SRC="vendor/shim/sqlite_shim.c vendor/sqlite-amalgamation/sqlite3.c"
OUT="${1:-build/libcutils_sqlite.so}"
# No explicit path on Windows (git-bash uname): the binding looks for .dll.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*|Windows_NT) OUT="${1:-build/libcutils_sqlite.dll}" ;; esac
CC="${CC:-cc}"

mkdir -p "$(dirname "$OUT")"
case "$OUT" in
  *.dll)
    # mingw lld always emits an import lib and a PDB next to the DLL; pin the
    # implib name and delete both so only the DLL lands in prebuilt/.
    $CC $BASE -g0 -shared $SRC -o "$OUT" -Wl,--out-implib="$OUT.implib"
    rm -f "$OUT.implib" "${OUT%.dll}.pdb"
    ;;
  *)
    case "$(uname -s)" in
      Darwin)
        $CC $BASE -fPIC -dynamiclib $SRC -o "$OUT" -lm
        ;;
      Linux|*GNU*)
        $CC $BASE -fPIC -Wl,-Bsymbolic -shared $SRC -o "$OUT" -lm
        ;;
      *)
        echo "build-shared: unsupported platform $(uname -s)" >&2
        exit 1
        ;;
    esac
    ;;
esac
echo "built $OUT"
