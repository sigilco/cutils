// Help and version output tests for @cutils/cli.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, command, num, run, str } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

function prog() {
  return {
    name: "demo",
    version: "1.0.0",
    description: "a demo program",
    commands: {
      greet: command("greet someone", {
        args: ["name"],
        options: {
          upper: bool({ short: "u", description: "uppercase output" }),
          times: num({ short: "t", default: 1, description: "repeat n times" }),
        },
        handler: () => {},
      }),
      add: command("add numbers", {
        args: ["a", "b"],
        handler: () => {},
      }),
    },
  };
}

test("no args prints program help", () => {
  const r = capture(() => run(prog(), []));
  assert.equal(r.code, 0);
  const out = r.out.join("\n");
  assert.match(out, /demo 1\.0\.0 — a demo program/);
  assert.match(out, /Usage: demo <command> \[options\]/);
  assert.match(out, /Commands:/);
  assert.match(out, /greet +greet someone/);
  assert.match(out, /add +add numbers/);
  assert.match(out, /--version +show version/);
});

test("--help and -h print program help", () => {
  for (const flag of ["--help", "-h"]) {
    const r = capture(() => run(prog(), [flag]));
    assert.equal(r.code, 0);
    assert.match(r.out.join("\n"), /Usage: demo <command>/);
  }
});

test("--version prints name and version", () => {
  const r = capture(() => run(prog(), ["--version"]));
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ["demo 1.0.0"]);
});

test("--version without a version prints just the name", () => {
  const p = prog();
  delete p.version;
  const r = capture(() => run(p, ["--version"]));
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ["demo"]);
});

test("<cmd> --help prints usage, args, options table", () => {
  const r = capture(() => run(prog(), ["greet", "--help"]));
  assert.equal(r.code, 0);
  const out = r.out.join("\n");
  assert.match(out, /demo greet — greet someone/);
  assert.match(out, /Usage: demo greet <name> \[options\]/);
  assert.match(out, /Arguments:/);
  assert.match(out, /<name>/);
  assert.match(out, /-u, --upper +uppercase output/);
  assert.match(out, /-t, --times <n> +repeat n times \(default: 1\)/);
  assert.match(out, /-h, --help +show help/);
});

test("<cmd> -h prints command help when h is unclaimed", () => {
  const r = capture(() => run(prog(), ["greet", "-h"]));
  assert.equal(r.code, 0);
  assert.match(r.out.join("\n"), /Usage: demo greet/);
});

test("-h resolves to a user-declared short option first", () => {
  let seen;
  const p = {
    name: "demo",
    commands: {
      c: command("c", {
        options: { host: str({ short: "h" }) },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "-h", "example.com"]));
  assert.equal(r.code, 0);
  assert.equal(seen.host, "example.com");
});

test("command without options still prints an options table with help", () => {
  const r = capture(() => run(prog(), ["add", "--help"]));
  assert.equal(r.code, 0);
  const out = r.out.join("\n");
  assert.match(out, /Usage: demo add <a> <b>/);
  assert.doesNotMatch(out, /\[options\]/);
  assert.match(out, /-h, --help +show help/);
});

test("command help works mid-argv (flags before it still parse)", () => {
  // --help is checked during the parse, after `--` it is positional.
  const r = capture(() =>
    run(
      {
        name: "d",
        commands: {
          c: command("c", {
            args: ["x"],
            handler: (opts, args) => {
              assert.deepEqual(args, ["--help"]);
            },
          }),
        },
      },
      ["c", "--", "--help"],
    ),
  );
  assert.equal(r.code, 0);
});
