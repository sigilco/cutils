#!/usr/bin/env bash
# Build test/elf-app.ts to a native ELF (scriptc build) and run it: the
# binary fills a cache past max, asserts eviction order and TTL expiry,
# then prints OK. Requires `pnpm install` at the workspace root (scriptc
# is a root devDependency).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail() {
  echo "elf-cache-smoke FAIL: $*" >&2
  exit 1
}

# Prefer the workspace-root binary; fall back to PATH.
BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi
"$BIN" build test/elf-app.ts -o "$T/cache-elf" >/dev/null || fail "scriptc build"
echo "build OK"

out="$("$T/cache-elf")" || fail "elf run"
[ "$out" = "OK" ] || fail "unexpected output: $out"

echo "elf-cache-smoke OK"
