#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/sqlite: packs the package, installs
# the tarball into a scratch app under build/, and compiles a consumer
# program against the published "./elf" entry + "ffi.json" — the same path
# a real consumer's `scriptc build` takes from node_modules. Catches
# regressions the in-repo gate cannot see (dist JS emitting raw shim_*
# calls with no ambient declare surface → SC5002; class instances crossing
# internal module boundaries; repo-layout `libraries` paths).
set -euo pipefail

cd "$(dirname "$0")/.."
PKG="$PWD"

fail() {
  echo "consumer-elf.test.sh FAIL: $*" >&2
  exit 1
}

if [ ! -f build/libsqlite3-shim.a ]; then
  fail "build/libsqlite3-shim.a missing — run pnpm build first"
fi

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
SQLITE="$WORK/node_modules/@cutils/sqlite"
[ -f "$SQLITE/ffi.json" ] || fail "ffi.json missing from installed package"
[ -f "$SQLITE/elf/shims.d.ts" ] || fail "elf/shims.d.ts missing from installed package"
[ -f "$SQLITE/build/libsqlite3-shim.a" ] || fail "archive missing from installed package"

# scriptc only applies ambient `declare function` bindings from files inside
# the consumer's own program — copy the shipped declarations beside the
# entry and reference them.
cp "$SQLITE/elf/shims.d.ts" ./shims.d.ts

cat > app.ts <<'TS'
/// <reference path="./shims.d.ts" />
import { Database } from "@cutils/sqlite/elf";

function main(): void {
  const db = Database.openInMemory();
  db.exec("CREATE TABLE t (name TEXT)");
  const ins = db.prepareRaw("INSERT INTO t (name) VALUES (?)");
  ins.run(["hello"]);
  ins.run([""]);
  ins.finalize();
  const sel = db.prepareRaw("SELECT name FROM t ORDER BY rowid");
  const rows = sel.all([]);
  sel.finalize();
  // An empty-string param must round-trip as '' — not NULL.
  const v0 = (rows[0] as { name: unknown }).name;
  const v1 = (rows[1] as { name: unknown }).name;
  const s0 = typeof v0 === "string" ? "'" + v0 + "'" : "<nonstring>";
  let s1 = "<nonstring>";
  if (v1 === null) {
    s1 = "NULL";
  } else if (typeof v1 === "string") {
    s1 = "'" + v1 + "'";
  }
  console.log("row0=" + s0 + " row1=" + s1);
}

main();
TS

"$BIN" build app.ts --npm-static @cutils/sqlite --ffi "$SQLITE/ffi.json" -o app-elf \
  || fail "scriptc build"

out=$(./app-elf) || fail "app-elf exited nonzero"
printf '%s\n' "$out" | grep -q "row0='hello' row1=''" \
  || fail "expected \"row0='hello' row1=''\", got: $out"
echo "consumer-elf.test.sh OK"
