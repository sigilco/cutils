#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/mongo: packs the package, installs
# the tarball into a scratch app under build/, and compiles a small
# consumer program against the published "./elf" entry via --npm-static —
# the same path a real consumer's `scriptc build` takes from node_modules.
# Runs the ELF against test/mock-server.mjs (canned OP_MSG wire server).
set -euo pipefail

cd "$(dirname "$0")/.."
PKG="$PWD"

fail() {
  echo "consumer-elf.test.sh FAIL: $*" >&2
  exit 1
}

BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="$PKG/../../node_modules/.bin/scriptc"
fi

WORK="$PKG/build/consumer-smoke"
rm -rf "$WORK"
mkdir -p "$WORK"

corepack pnpm pack --pack-destination "$WORK" >/dev/null || fail "pnpm pack"
TARBALL=$(find "$WORK" -maxdepth 1 -name '*.tgz' | head -1)
[ -n "$TARBALL" ] || fail "pnpm pack produced no tarball"

cd "$WORK"
cat > package.json <<'JSON'
{ "name": "consumer-smoke", "private": true, "type": "module" }
JSON

corepack pnpm add --ignore-workspace "$TARBALL" >/dev/null || fail "pnpm add tarball"
[ -f "$WORK/node_modules/@cutils/mongo/dist/esm/index.js" ] || fail "dist/esm/index.js missing"

cp "$PKG/test/consumer-elf-app.ts" app.ts

"$BIN" build app.ts --npm-static @cutils/mongo -o app-elf \
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
printf '%s\n' "$out" | grep -q "consumer OK" || fail "expected 'consumer OK', got: $out"
echo "consumer-elf.test.sh OK"
