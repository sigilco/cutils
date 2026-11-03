#!/usr/bin/env bash
# ELF smoke for @cutils/ffi: compiles gate.ts — which echoes a Rust struct —
# via `scriptc build --ffi`, runs it, and asserts the "gate OK" line.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "elf.test.sh FAIL: $*" >&2
  exit 1
}

if [ ! -f build/libcutils_ffi_echo.a ]; then
  fail "build/libcutils_ffi_echo.a missing — run pnpm build first"
fi

BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi
"$BIN" build gate.ts --ffi gate.ffi.json -o build/gate-elf \
  || fail "scriptc build"

out=$(./build/gate-elf) || fail "gate-elf exited nonzero"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "elf.test.sh OK"
