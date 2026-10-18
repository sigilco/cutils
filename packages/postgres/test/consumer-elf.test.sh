#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/postgres: packs the package, installs
# the tarball into a scratch app under build/, and compiles gate.ts — the
# full public surface — against the published "./elf" entry via
# `--npm-static`, the same path a real consumer's `scriptc build` takes
# from node_modules. Catches regressions the in-repo gate cannot see:
# JS-inference `unknown` holes in the shipped dist JS (untyped receivers
# fence at runtime with "calling 'x' on this native class through an
# untyped value" / SC2020 deferred throws).
set -euo pipefail

cd "$(dirname "$0")/.."
PKG="$PWD"

fail() {
  echo "consumer-elf.test.sh FAIL: $*" >&2
  exit 1
}

# Prefer the workspace-root binary; `pnpm exec` resolves to a stray PATH
# pnpm on some machines.
BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="$PKG/../../node_modules/.bin/scriptc"
fi

WORK="$PKG/build/consumer-smoke"
rm -rf "$WORK"
mkdir -p "$WORK"

# Pack exactly as publish would (pnpm rewrites workspace: ranges; npm would
# not).
corepack pnpm pack --pack-destination "$WORK" >/dev/null || fail "pnpm pack"
TARBALL=$(find "$WORK" -maxdepth 1 -name '*.tgz' | head -1)
[ -n "$TARBALL" ] || fail "pnpm pack produced no tarball"

cd "$WORK"
cat > package.json <<'JSON'
{ "name": "consumer-smoke", "private": true, "type": "module" }
JSON

# --ignore-workspace: the scratch app lives inside the monorepo, but it is a
# consumer, not a workspace member.
corepack pnpm add --ignore-workspace "$TARBALL" >/dev/null || fail "pnpm add tarball"
PG="$WORK/node_modules/@cutils/postgres"
[ -f "$PG/dist/esm/index.js" ] || fail "dist/esm/index.js missing from installed package"

# The gate program exercises every public surface; point it at the packed
# "./elf" entry exactly as a consumer would.
sed -e 's|"./src/index.ts"|"@cutils/postgres/elf"|g' \
  "$PKG/gate.ts" > app.ts
grep -q '@cutils/postgres/elf' app.ts || fail "gate rewrite produced no elf import"

"$BIN" build app.ts --npm-static @cutils/postgres -o app-elf \
  || fail "scriptc build"

node "$PKG/test/mock-server.mjs" 0 > "$WORK/srv.out" &
SRV_PID=$!
trap '[ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  [ -s "$WORK/srv.out" ] && break
  sleep 0.1
done
PORT="$(awk '/READY/{print $2}' "$WORK/srv.out")"
[ -n "$PORT" ] || fail "mock server did not start"

out="$(timeout 30 ./app-elf "$PORT")" || fail "app-elf exited nonzero"
printf '%s\n' "$out" | grep -q "gate OK" || fail "expected 'gate OK', got: $out"
echo "consumer-elf.test.sh OK"
