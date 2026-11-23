#!/usr/bin/env bash
# Packs every publishable package, installs the tarballs into a fresh app,
# and asserts each one resolves from its packed dist entry point.
# Per-package ELF smokes live in packages/*/test/elf.test.sh; this script only
# proves the tarballs are installable and importable.
# Requires `pnpm -r build` and `pnpm install` to have run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"

cleanup() {
  rm -rf "$T"
}
trap cleanup EXIT

fail() {
  echo "pack-smoke FAIL: $*" >&2
  exit 1
}

cd "$ROOT"
# @cutils/sqlite ships a prebuilt shared library per platform; release CI
# assembles all of them, here we build the host one so the tarball carries it
# and the Node smoke below exercises the prebuilt path.
pnpm --filter @cutils/sqlite build:prebuilt >/dev/null
mkdir -p "$T/tar" "$T/app"
pnpm -r --filter "./packages/*" pack --pack-destination "$T/tar" >/dev/null

shopt -s nullglob
tarballs=( "$T"/tar/*.tgz )
if [ "${#tarballs[@]}" -eq 0 ]; then
  echo "pack-smoke: no packages to pack, skipping"
  exit 0
fi

printf '{"private":true,"type":"module"}\n' >"$T/app/package.json"
(cd "$T/app" && pnpm add --ignore-workspace "${tarballs[@]}" >/dev/null)

for tgz in "${tarballs[@]}"; do
  name=$(tar -xzOf "$tgz" package/package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).name")
  (cd "$T/app" && node -e "import('$name').then(() => console.log('resolve OK: $name')).catch((e) => { console.error('resolve FAIL: $name', e.message); process.exit(1); })") \
    || fail "import $name"
done

# @cutils/sqlite on Node: no consumer-side build step. koffi is the optional
# peer; pin it to the range the package declares.
KOFFI_RANGE=$(node -p "require('./packages/sqlite/package.json').peerDependencies.koffi")
(cd "$T/app" && pnpm add --ignore-workspace --allow-build=koffi "koffi@$KOFFI_RANGE" >/dev/null) || fail "install koffi"
SQLITE_DIR="$T/app/node_modules/@cutils/sqlite"
cat >"$T/app/sqlite-smoke.mjs" <<'JS'
import { libraryPath, librarySource } from "@cutils/sqlite/node-binding";
import { Database } from "@cutils/sqlite";
const expect = process.argv[2];
if (librarySource !== expect) throw new Error(`library source ${librarySource}, expected ${expect} (${libraryPath})`);
const db = Database.openInMemory();
db.exec("CREATE VIRTUAL TABLE t USING fts5(body)");
db.exec("INSERT INTO t(body) VALUES ('hello packed world')");
const row = db.prepareRaw("SELECT count(*) AS n FROM t WHERE t MATCH ?").get(["packed"]);
if (row.n !== 1) throw new Error(`bad row ${JSON.stringify(row)}`);
db.close();
console.log(`sqlite node-binding OK (${librarySource}: ${libraryPath})`);
JS
# 1. shipped prebuilt for this platform
(cd "$T/app" && node sqlite-smoke.mjs prebuilt) || fail "sqlite node-binding (prebuilt)"
# 2. no prebuilt for this platform: compiles from the vendored sources
rm -rf "$SQLITE_DIR/prebuilt" "$SQLITE_DIR/build/libcutils_sqlite.so"
(cd "$T/app" && node sqlite-smoke.mjs compiled) || fail "sqlite node-binding (compile fallback)"

echo "pack-smoke OK"
