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

echo "pack-smoke OK"
