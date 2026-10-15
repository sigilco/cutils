#!/usr/bin/env bash
# Fails unless every gate app reports 100% static under `scriptc coverage`.
# Gates are the compile entries named in each package AGENTS.md, discovered as
# packages/*/gate.ts. Run after `pnpm -r build`.
set -euo pipefail

cd "$(dirname "$0")/.."

shopt -s nullglob
GATES=( packages/*/gate.ts bench/apps/*.ts )

if [ "${#GATES[@]}" -eq 0 ]; then
  echo "scriptc-gate: no gate entries found, skipping"
  exit 0
fi

# Prefer the workspace-root binary; `pnpm exec` resolves to a stray PATH
# pnpm on some machines.
BIN="scriptc"
if [ -x node_modules/.bin/scriptc ]; then
  BIN="node_modules/.bin/scriptc"
fi

fail=0
for gate in "${GATES[@]}"; do
  # Per-gate FFI manifest: a gate.ffi.json sibling of gate.ts is passed as
  # --ffi so outbound native calls count as compiled (e.g. packages/sqlite).
  ffi_args=()
  ffi_manifest="${gate%.ts}.ffi.json"
  if [ -f "$ffi_manifest" ]; then
    ffi_args=( --ffi "$ffi_manifest" )
  fi
  out=$("$BIN" coverage "$gate" "${ffi_args[@]}" 2>&1) || true
  line=$(printf '%s\n' "$out" | grep -E 'compile statically' || true)
  if [[ "$line" == *"(100%)"* ]]; then
    printf 'ok   %s %s\n' "$gate" "$(printf '%s' "$line" | tr -s ' ')"
  else
    printf 'FAIL %s %s\n' "$gate" "${line:-no coverage line}"
    printf '%s\n' "$out" | tail -20
    fail=1
  fi
done
exit "$fail"
