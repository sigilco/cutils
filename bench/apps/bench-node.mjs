// Node-mode parse benchmark for @cutils/cli vs commander vs
// node:util.parseArgs vs a hand-rolled argv loop. Each cell measures
// ops/sec over a fixed argv — spec construction happens once outside the
// timed loop, matching how a real CLI builds its spec at module load.
//
// Run: node bench/apps/bench-node.mjs [--json]

import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { bool, command, int, run, str } from "@cutils/cli";
import { Command } from "commander";

const ITER_MS = 1500; // per-cell timed window
const WARMUP = 2000;

// ---------------------------------------------------------------- argv shapes
// A typical options-heavy invocation, and a subcommand dispatch.
const ARGV_OPTS = ["greet", "-u", "-t", "5", "--greeting", "hi", "world"];
const ARGV_SUB = ["deploy", "web", "--target", "prod"];

// ---------------------------------------------------------------- contestants

// @cutils/cli
const cutilsProg = {
  name: "demo",
  version: "1.0.0",
  commands: {
    greet: command("greet", {
      args: ["name"],
      options: {
        upper: bool({ short: "u" }),
        times: int({ short: "t", default: 1 }),
        greeting: str({ short: "g" }),
      },
      handler: () => {},
    }),
    deploy: command("deploy", {
      commands: {
        web: command("deploy web", {
          options: { target: str() },
          handler: () => {},
        }),
      },
    }),
  },
};

// commander — same surface. parse() on a configured Command.
const cmdr = new Command();
cmdr.exitOverride(); // never process.exit from the benchmark
cmdr
  .command("greet")
  .argument("<name>")
  .option("-u, --upper")
  .option("-t, --times <n>", "repeat", "1")
  .option("-g, --greeting <w>")
  .action(() => {});
// commander subtree: deploy → web
const cmdr2 = new Command();
cmdr2.exitOverride();
const dep = cmdr2.command("deploy");
dep.exitOverride();
dep
  .command("web")
  .option("--target <t>")
  .action(() => {});

// node:util.parseArgs baseline
const parseArgsCfg = {
  allowPositionals: true,
  options: {
    upper: { type: "boolean", short: "u" },
    times: { type: "string", short: "t" },
    greeting: { type: "string", short: "g" },
    target: { type: "string" },
  },
};

// hand-rolled argv baseline
function handrolled(argv) {
  const values = { upper: false, times: "1", greeting: "" };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "-u" || tok === "--upper") values.upper = true;
    else if (tok === "-t" || tok === "--times") values.times = argv[++i] ?? "";
    else if (tok === "-g" || tok === "--greeting") values.greeting = argv[++i] ?? "";
    else if (tok[0] !== "-") pos.push(tok);
  }
  return [values, pos];
}

// ---------------------------------------------------------------- harness
function cell(name, argv, fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < ITER_MS) {
    fn();
    n++;
  }
  const ms = performance.now() - t0;
  return { name, argv: argv.join(" "), ops: Math.round((n / ms) * 1000) };
}

const cells = [
  cell("cutils  opts", ARGV_OPTS, () => run(cutilsProg, ARGV_OPTS)),
  cell("commander opts", ARGV_OPTS, () => cmdr.parse(ARGV_OPTS, { from: "user" })),
  cell("parseArgs opts", ARGV_OPTS.slice(1), () =>
    parseArgs({ args: ARGV_OPTS.slice(1), ...parseArgsCfg }),
  ),
  cell("handrolled opts", ARGV_OPTS, () => handrolled(ARGV_OPTS)),
  cell("cutils  subtree", ARGV_SUB, () => run(cutilsProg, ARGV_SUB)),
  cell("commander subtree", ARGV_SUB, () => cmdr2.parse(ARGV_SUB, { from: "user" })),
];

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify(cells, null, 2));
} else {
  let w = 0;
  for (const c of cells) w = Math.max(w, c.name.length);
  console.log("ops/sec — higher is better\n");
  for (const c of cells) {
    console.log(`  ${c.name.padEnd(w)}  ${String(c.ops).padStart(9)} ops/s   (${c.argv})`);
  }
}
