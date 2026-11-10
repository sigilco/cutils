#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/cache: packs the package, installs
# the tarball into a scratch app under build/, and compiles the app — the
# get/set/has/delete/peek + TTL matrix — against the published "./elf"
# entry via `--npm-static`, the same path a real consumer's
# `scriptc build` takes from node_modules. Catches regressions the
# in-repo gate cannot see: JS-inference holes in the shipped dist JS.
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
CACHE="$WORK/node_modules/@cutils/cache"
[ -f "$CACHE/dist/esm/index.js" ] || fail "dist/esm/index.js missing from installed package"
[ -f "$CACHE/dist/esm/cache.js" ] || fail "dist/esm/cache.js missing from installed package"

# The app exercises the public surface through the packed "./elf" entry
# exactly as a consumer would.
cat > app.ts <<'TS'
import { Cache } from "@cutils/cache/elf";

function assert(cond: boolean, what: string): void {
  if (!cond) {
    throw new Error("consumer-elf FAIL: " + what);
  }
}

// --- basic get/set/has/delete ---
const c = new Cache({ max: 100 });
c.set("a", "1");
assert(c.get("a") === "1", "get round-trip");
assert(c.has("a") === true, "has after set");
assert(c.has("nope") === false, "has miss");
assert(c.size === 1, "size");
c.delete("a");
assert(c.has("a") === false, "has after delete");
assert(c.get("a") === null, "get after delete");

// --- peek does not bump; get does ---
const r = new Cache({ max: 2 });
r.set("a", 1);
r.set("b", 2);
r.peek("a");
r.set("c", 3);
assert(r.get("a") === null, "peek must not bump recency");
assert(r.get("b") === 2, "b survives");

// --- ttl: per-set override + lazy expiry with a fake clock ---
let t = 1000;
const d = new Cache({ ttl: 500 }, () => t);
d.set("x", "y");
assert(d.has("x") === true, "fresh within ttl");
d.set("per", "z", { ttl: 100 });
assert(d.get("per") === "z", "per-set ttl override");
t = 1600;
assert(d.has("x") === false, "x expired");
assert(d.get("x") === null, "expired get is null");
assert(d.peek("per") === null, "expired peek is null");

// --- clear ---
c.set("k", "v");
c.clear();
assert(c.size === 0 && c.has("k") === false, "clear");

// --- option validation ---
let threw = false;
try {
  new Cache({ max: 0 });
} catch {
  threw = true;
}
assert(threw, "max must be positive");
threw = false;
try {
  new Cache().set("k", "v", { ttl: 0 });
} catch {
  threw = true;
}
assert(threw, "per-set ttl must be positive");

console.log("consumer-elf OK");
TS

"$BIN" build app.ts --npm-static @cutils/cache -o app-elf \
  || fail "scriptc build"
grep -q "@cutils/cache/elf" app.ts || fail "app lost the elf import"

out="$(timeout 30 ./app-elf)" || fail "app-elf exited nonzero"
printf '%s\n' "$out" | grep -q "consumer-elf OK" || fail "unexpected output: $out"
echo "consumer-elf.test.sh OK"
