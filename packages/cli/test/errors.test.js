// Error-path tests for @cutils/cli — every failure is "error: ..." on
// stderr + exit code 1; nothing throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, command, num, run } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

function prog() {
  return {
    name: "demo",
    version: "1.0.0",
    commands: {
      greet: command("greet someone", {
        args: ["name"],
        options: {
          upper: bool({ short: "u" }),
          times: num({ short: "t", default: 1 }),
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

test("missing required argument names the missing arg", () => {
  const r = capture(() => run(prog(), ["greet"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /error: missing required argument 'name'/);
});

test("missing second positional names it", () => {
  const r = capture(() => run(prog(), ["add", "1"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /missing required argument 'b'/);
});

test("extra positional is an unexpected-argument error", () => {
  const r = capture(() => run(prog(), ["greet", "a", "b"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /error: unexpected argument 'b'/);
});

test("non-numeric option value errors with the option label", () => {
  for (const argv of [
    ["greet", "--times", "abc", "x"],
    ["greet", "--times=abc", "x"],
    ["greet", "-t", "abc", "x"],
    ["greet", "-tabc", "x"],
  ]) {
    const r = capture(() => run(prog(), argv));
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.match(r.err.join("\n"), /expected a number, got 'abc'/);
  }
});

test("missing option value errors", () => {
  for (const argv of [
    ["greet", "x", "--times"],
    ["greet", "x", "-t"],
  ]) {
    const r = capture(() => run(prog(), argv));
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.match(r.err.join("\n"), /requires a value/);
  }
});

test("unknown long option", () => {
  const r = capture(() => run(prog(), ["greet", "--bogus", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /error: unknown option '--bogus'/);
});

test("unknown short option", () => {
  const r = capture(() => run(prog(), ["greet", "-z", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /error: unknown option '-z'/);
});

test("boolean option rejects a non-boolean attached value", () => {
  const r = capture(() => run(prog(), ["greet", "--upper=maybe", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /expected a boolean, got 'maybe'/);
});

test("unknown command suggests on edit distance <= 2", () => {
  const r = capture(() => run(prog(), ["gret", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /unknown command 'gret' — did you mean 'greet'\?/);
});

test("unknown command suggests on prefix", () => {
  const r = capture(() => run(prog(), ["gre", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /did you mean 'greet'\?/);
});

test("far-away command name gets no suggestion", () => {
  const r = capture(() => run(prog(), ["xyzzy"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /unknown command 'xyzzy'/);
  assert.doesNotMatch(r.err.join("\n"), /did you mean/);
});

test("top-level unknown option", () => {
  const r = capture(() => run(prog(), ["--bogus"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /unknown option '--bogus'/);
});
