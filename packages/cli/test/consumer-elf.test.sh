#!/usr/bin/env bash
# Consumer-side ELF smoke for @cutils/cli: packs the package, installs the
# tarball into a scratch app under build/, and compiles gate.ts — the full
# public surface — against the published "./elf" entry via `--npm-static`,
# the same path a real consumer's `scriptc build` takes from node_modules.
# Catches regressions the in-repo gate cannot see: JS-inference `unknown`
# holes in the shipped dist JS (SC9001 nullT / SC2020 deferred throws).
# The .d.ts surface is hidden in that mode, so type-only imports are
# rewritten to a value import of the main entry (types resolve from it).
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
CLI="$WORK/node_modules/@cutils/cli"
[ -f "$CLI/dist/esm/index.js" ] || fail "dist/esm/index.js missing from installed package"

# Point the gate at the packed "./elf" entry exactly as a consumer would.
# gate.ts's type-only imports resolve against the main entry's .d.ts; the
# runtime import must be the elf entry.
sed -e 's|"./src/index.ts"|"@cutils/cli/elf"|g' \
  "$PKG/gate.ts" > app.ts
grep -q '@cutils/cli/elf' app.ts || fail "gate rewrite produced no elf import"

"$BIN" build app.ts --npm-static @cutils/cli -o app-elf \
  || fail "scriptc build"

run_ok() { # run_ok <desc> <expected-substring> <args...>
  local desc="$1" want="$2"
  shift 2
  local out
  out="$(timeout 30 ./app-elf "$@" 2>&1)" || fail "$desc: exited nonzero: $out"
  printf '%s\n' "$out" | grep -q "$want" || fail "$desc: expected '$want', got: $out"
}

run_err() { # run_err <desc> <expected-substring> <args...>
  local desc="$1" want="$2"
  shift 2
  local out rc
  out="$(timeout 30 ./app-elf "$@" 2>&1)" && rc=0 || rc=$?
  [ "$rc" -ne 0 ] || fail "$desc: expected nonzero exit"
  printf '%s\n' "$out" | grep -q "$want" || fail "$desc: expected '$want', got: $out"
}

# Flags: short + long, repeated, default fill.
run_ok "short flag"      "WORLD"          greet world --upper
run_ok "repeated value"  "hi world"       greet world -t 2
run_ok "long flag"      "hi world"       greet --times=2 --greeting hi world

# Variadic option + variadic positional.
run_ok "variadic args"   "2 tags on 2 files" tags a b --tag x y
run_ok "variadic attach" "2 tags on 2 files" tags f1 f2 --dry-run --tag a b

# Subcommand descent + alias.
run_ok "sub descent"     "web → prod"     tree deploy web --target prod
run_ok "sub alias"       "api"            tree deploy a
run_ok "group help"     "Usage: tree deploy <command>" tree deploy --help

# Help surfaces.
run_ok "root help"       "Usage: demo <command>" --help
run_ok "command help"    "Usage: demo greet" greet --help

# Errors.
run_ok "unknown cmd"     "unknown command 'gret'" gret
run_ok "missing arg"     "missing required argument 'name'" greet
run_ok "bad value"       "times too large" greet world --times 99

echo "consumer-elf.test.sh OK"
