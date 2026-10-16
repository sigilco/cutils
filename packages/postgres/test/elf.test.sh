#!/usr/bin/env bash
# ELF smoke for @cutils/postgres: compiles gate.ts — which exercises every
# public surface — to a native executable via `scriptc build`, starts the
# canned wire-protocol server, runs the ELF against it over real TCP, and
# asserts the "gate OK" line. The TCP-from-ELF check is the point: it proves
# node:net + node:crypto lower correctly.
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

T="$(mktemp -d)"
trap 'rm -rf "$T"; [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true' EXIT

"$BIN" build gate.ts -o "$T/gate-elf" || fail "scriptc build"
echo "build OK"

node test/mock-server.mjs 0 > "$T/srv.out" &
SRV_PID=$!
# Wait for READY <port>
for _ in $(seq 1 50); do
  [ -s "$T/srv.out" ] && break
  sleep 0.1
done
PORT="$(awk '/READY/{print $2}' "$T/srv.out")"
[ -n "$PORT" ] || fail "mock server did not start"

out="$(timeout 15 "$T/gate-elf" "$PORT")" || fail "gate-elf exited nonzero"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "elf.test.sh OK"
