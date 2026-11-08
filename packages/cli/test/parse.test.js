// Option/positional parsing tests for @cutils/cli — runs on the tsc build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, run } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

function prog(handler) {
  return {
    name: "demo",
    version: "1.0.0",
    commands: {
      greet: command("greet someone", {
        args: ["name"],
        options: {
          upper: { type: "boolean", short: "u", description: "uppercase" },
          times: { type: "number", short: "t", default: 1, description: "repeat" },
          greeting: { type: "string", short: "g", description: "greeting word" },
        },
        handler,
      }),
    },
  };
}

test("long boolean flag and defaults", () => {
  let seen;
  const p = prog((opts, args) => {
    seen = { opts, args };
  });
  const r = capture(() => run(p, ["greet", "--upper", "world"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen.opts, { upper: true, times: 1, greeting: "" });
  assert.deepEqual(seen.args, ["world"]);
});

test("boolean stays false and number zero-defaults without flags", () => {
  let seen;
  const p = prog((opts) => {
    seen = opts;
  });
  const r = capture(() => run(p, ["greet", "world"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, { upper: false, times: 1, greeting: "" });
});

test("--opt value and --opt=value", () => {
  const got = [];
  const p = prog((opts) => got.push(opts));
  capture(() => run(p, ["greet", "--times", "3", "world"]));
  capture(() => run(p, ["greet", "--times=4", "world"]));
  assert.equal(got[0].times, 3);
  assert.equal(got[1].times, 4);
});

test("string option long and short forms", () => {
  const got = [];
  const p = prog((opts) => got.push(opts));
  capture(() => run(p, ["greet", "--greeting", "hi", "world"]));
  capture(() => run(p, ["greet", "--greeting=yo", "world"]));
  capture(() => run(p, ["greet", "-g", "hey", "world"]));
  capture(() => run(p, ["greet", "-ghey", "world"]));
  assert.equal(got[0].greeting, "hi");
  assert.equal(got[1].greeting, "yo");
  assert.equal(got[2].greeting, "hey");
  assert.equal(got[3].greeting, "hey");
});

test("short flags: -u, -t 3, -t3, clustered -ut3", () => {
  const got = [];
  const p = prog((opts) => got.push(opts));
  capture(() => run(p, ["greet", "-u", "world"]));
  capture(() => run(p, ["greet", "-t", "2", "world"]));
  capture(() => run(p, ["greet", "-t3", "world"]));
  capture(() => run(p, ["greet", "-ut3", "world"]));
  assert.deepEqual(got[0], { upper: true, times: 1, greeting: "" });
  assert.deepEqual(got[1], { upper: false, times: 2, greeting: "" });
  assert.deepEqual(got[2], { upper: false, times: 3, greeting: "" });
  assert.deepEqual(got[3], { upper: true, times: 3, greeting: "" });
});

test("--flag=false parses boolean attached values", () => {
  const got = [];
  const p = prog((opts) => got.push(opts));
  capture(() => run(p, ["greet", "--upper=false", "world"]));
  capture(() => run(p, ["greet", "--upper=1", "world"]));
  capture(() => run(p, ["greet", "--upper=0", "world"]));
  assert.equal(got[0].upper, false);
  assert.equal(got[1].upper, true);
  assert.equal(got[2].upper, false);
});

test("-- ends option parsing; later tokens are positional", () => {
  let seen;
  const p = prog((opts, args) => {
    seen = { opts, args };
  });
  const r = capture(() => run(p, ["greet", "--", "-u"]));
  assert.equal(r.code, 0);
  assert.equal(seen.opts.upper, false);
  assert.deepEqual(seen.args, ["-u"]);
});

test("options may follow positionals", () => {
  let seen;
  const p = prog((opts) => {
    seen = opts;
  });
  const r = capture(() => run(p, ["greet", "world", "-u"]));
  assert.equal(r.code, 0);
  assert.equal(seen.upper, true);
});

test("negative numbers as option values", () => {
  let seen;
  const p = prog((opts) => {
    seen = opts;
  });
  const r = capture(() => run(p, ["greet", "--times=-2", "world"]));
  assert.equal(r.code, 0);
  assert.equal(seen.times, -2);
});

test("float numbers parse", () => {
  let seen;
  const p = prog((opts) => {
    seen = opts;
  });
  capture(() => run(p, ["greet", "-t", "2.5", "world"]));
  assert.equal(seen.times, 2.5);
});
