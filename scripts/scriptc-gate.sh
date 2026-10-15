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

fail=0
for gate in "${GATES[@]}"; do
  out=$(pnpm exec scriptc coverage "$gate" 2>&1) || true
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
