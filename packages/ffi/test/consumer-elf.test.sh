#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/ffi: packs the package, installs the
# tarball, compiles against "./elf" + "ffi.json".
set -euo pipefail

cd "$(dirname "$0")/.."
PKG="$PWD"

fail() {
  echo "consumer-elf.test.sh FAIL: $*" >&2
  exit 1
}

if [ ! -f build/libcutils_ffi_echo.a ]; then
  fail "build/libcutils_ffi_echo.a missing — run pnpm build first"
fi

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
FFI="$WORK/node_modules/@cutils/ffi"
[ -f "$FFI/ffi.json" ] || fail "ffi.json missing from installed package"
[ -f "$FFI/elf/shims.d.ts" ] || fail "elf/shims.d.ts missing from installed package"
[ -f "$FFI/build/libcutils_ffi_echo.a" ] || fail "archive missing from installed package"

cp "$FFI/elf/shims.d.ts" ./shims.d.ts

cat > app.ts <<'TS'
/// <reference path="./shims.d.ts" />
import { echoI32, echoPoint } from "@cutils/ffi/elf";

function main(): void {
  const n = echoI32(41);
  const out = echoPoint({ x: 41, y: -2, flags: 7, value: BigInt(99) });
  console.log("i32=" + String(n) + " x=" + String(out.x) + " y=" + String(out.y));
}

main();
TS

"$BIN" build app.ts --npm-static @cutils/ffi --ffi "$FFI/ffi.json" -o app-elf \
  || fail "scriptc build"

out=$(./app-elf) || fail "app-elf exited nonzero"
printf '%s\n' "$out" | grep -q "i32=41 x=42 y=-2" \
  || fail "expected \"i32=41 x=42 y=-2\", got: $out"
echo "consumer-elf.test.sh OK"
