#!/usr/bin/env bash
# ELF smoke for @cutils/mongo: compiles gate.ts — which exercises every
# public surface plus the BSON/OP_MSG/uri/SCRAM machinery — to a native
# executable via `scriptc build` (no FFI — pure node:net/tls/crypto), runs
# it, and asserts the "gate OK" line.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "elf.test.sh FAIL: $*" >&2
  exit 1
}

# Prefer the workspace-root binary; `pnpm exec` resolves to a stray PATH
# pnpm on some machines.
BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi
"$BIN" build gate.ts -o build/gate-elf \
  || fail "scriptc build"

out=$(./build/gate-elf) || fail "gate-elf exited nonzero"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "elf.test.sh OK"
