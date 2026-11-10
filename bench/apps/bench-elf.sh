#!/usr/bin/env bash
# ELF-mode bench for @cutils/cli: compiles each gate app with `scriptc
# build`, reports binary sizes (KB overhead vs the argv-only baseline) and
# process wall-time for a parse workload (spawnSync loop — no hyperfine
# dependency).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

APPS=(argv-baseline cli-basic cli-full)

for app in "${APPS[@]}"; do
  "$BIN" build "$app.ts" -o "$T/$app" >/dev/null
  bytes=$(stat -f %z "$T/$app" 2>/dev/null || stat -c %s "$T/$app")
  printf "%-16s %10d bytes\n" "$app" "$bytes"
done

echo ""
echo "startup+parse wall-clock (spawn, 200 runs, mean ms) — dominated by"
echo "process startup; parse work is sub-ms at this scale, so these numbers"
echo "measure binary startup cost, not parser throughput (see bench-node.mjs)."
node - "$T" <<'EOF'
const { spawnSync } = require("child_process");
const dir = process.argv[2];
const cases = [
  ["argv-baseline", ["greet", "-u", "-t", "5", "--greeting", "hi", "world"]],
  ["cli-basic",     ["greet", "-u", "-t", "5", "--greeting", "hi", "world"]],
  ["cli-full",      ["greet", "-u", "-t", "5", "--greeting", "hi", "world"]],
  ["cli-full",      ["deploy", "web"]],
  ["cli-full",      ["opt", "--color=always", "--no-cache", "x"]],
];
for (const [app, argv] of cases) {
  for (let i = 0; i < 5; i++) spawnSync(`${dir}/${app}`, argv); // warmup
  const t0 = process.hrtime.bigint();
  const N = 200;
  for (let i = 0; i < N; i++) spawnSync(`${dir}/${app}`, argv);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`  ${app.padEnd(14)} ${argv.join(" ").padEnd(46)} ${ms.toFixed(2)} ms/run`);
}
EOF
