#!/usr/bin/env bash
# ELF smoke for @cutils/sqlite: compiles gate.ts — which exercises every
# public surface — to a native executable via `scriptc build --ffi`, runs
# it, and asserts the "gate OK" line. Requires `pnpm build` to have run so
# build/libsqlite3-shim.a exists.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "elf.test.sh FAIL: $*" >&2
  exit 1
}

if [ ! -f build/libsqlite3-shim.a ]; then
  fail "build/libsqlite3-shim.a missing — run pnpm build first"
fi

pnpm exec scriptc build gate.ts --ffi gate.ffi.json -o build/gate-elf \
  || fail "scriptc build"

out=$(./build/gate-elf) || fail "gate-elf exited nonzero"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "elf.test.sh OK"
