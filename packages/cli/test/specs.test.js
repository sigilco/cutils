// Option-spec upgrade tests: optionalValue / variadic / negatable / env /
// camelCase / hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, command, int, run, str } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

test("optionalValue: bare → true, =v → string, no space form", () => {
  const got = [];
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["pos"],
        options: { color: { optionalValue: true } },
        handler: (opts, args) => got.push([opts, args]),
      }),
    },
  };
  capture(() => run(p, ["c", "--color", "x"]));
  capture(() => run(p, ["c", "--color=always", "x"]));
  // bare form leaves the next token a positional (commander semantics)
  assert.deepEqual(got[0][0].color, true);
  assert.deepEqual(got[0][1], ["x"]);
  assert.equal(got[1][0].color, "always");
});

test("optionalValue short: -x bare → true, -xv → 'v'", () => {
  const got = [];
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { color: { optionalValue: true, short: "c" } },
        handler: (opts) => got.push(opts),
      }),
    },
  };
  capture(() => run(p, ["c", "-c"]));
  capture(() => run(p, ["c", "-calways"]));
  assert.equal(got[0].color, true);
  assert.equal(got[1].color, "always");
});

test("variadic option: --tag a b and --tag a --tag b accumulate", () => {
  const got = [];
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [{ name: "files", variadic: true, optional: true }],
        options: { tag: { variadic: true } },
        handler: (opts, args) => got.push([opts, args]),
      }),
    },
  };
  capture(() => run(p, ["c", "f1", "--tag", "a", "b"]));
  capture(() => run(p, ["c", "f1", "--tag=a", "--tag=b"]));
  assert.deepEqual(got[0][0].tag, ["a", "b"]);
  assert.deepEqual(got[0][1], [["f1"]]);
  assert.deepEqual(got[1][0].tag, ["a", "b"]);
});

test("variadic option requires at least one value", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { tag: { variadic: true } },
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--tag"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /requires at least one value/);
});

test("variadic option schema validates per element", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { n: { variadic: true, schema: int().schema } },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--n", "1", "2", "3"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen.n, [1, 2, 3]);
  const bad = capture(() => run(p, ["c", "--n", "1", "x"]));
  assert.equal(bad.code, 1);
  assert.match(bad.err.join("\n"), /--n: expected a number/);
});

test("illegal spec combos throw at command()", () => {
  assert.throws(
    () => command("c", { options: { x: { flag: true, optionalValue: true } }, handler: () => {} }),
    /cannot be optionalValue or variadic/,
  );
  assert.throws(
    () => command("c", { options: { x: { flag: true, variadic: true } }, handler: () => {} }),
    /cannot be optionalValue or variadic/,
  );
  assert.throws(
    () =>
      command("c", { options: { x: { optionalValue: true, variadic: true } }, handler: () => {} }),
    /cannot be both optionalValue and variadic/,
  );
  assert.throws(
    () => command("c", { options: { x: { negatable: true } }, handler: () => {} }),
    /negatable applies to flags/,
  );
});

test("negatable flag: --no-x → false, --x → true", () => {
  const got = [];
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { cache: { flag: true, negatable: true, default: true } },
        handler: (opts) => got.push(opts),
      }),
    },
  };
  capture(() => run(p, ["c"]));
  capture(() => run(p, ["c", "--no-cache"]));
  capture(() => run(p, ["c", "--cache"]));
  assert.equal(got[0].cache, true);
  assert.equal(got[1].cache, false);
  assert.equal(got[2].cache, true);
});

test("env fallback: env value used when flag absent, explicit wins", () => {
  const got = [];
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { target: str({ env: "CUTILS_TEST_TARGET" }) },
        handler: (opts) => got.push(opts),
      }),
    },
  };
  const prev = process.env.CUTILS_TEST_TARGET;
  try {
    process.env.CUTILS_TEST_TARGET = "from-env";
    capture(() => run(p, ["c"]));
    capture(() => run(p, ["c", "--target", "explicit"]));
    assert.equal(got[0].target, "from-env");
    assert.equal(got[1].target, "explicit");
    delete process.env.CUTILS_TEST_TARGET;
    capture(() => run(p, ["c"]));
    assert.equal(got[2].target, "");
  } finally {
    if (prev === undefined) {
      delete process.env.CUTILS_TEST_TARGET;
    } else {
      process.env.CUTILS_TEST_TARGET = prev;
    }
  }
});

test("env value goes through the schema", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { n: int({ env: "CUTILS_TEST_N" }) },
        handler: () => {},
      }),
    },
  };
  const prev = process.env.CUTILS_TEST_N;
  try {
    process.env.CUTILS_TEST_N = "notanumber";
    const r = capture(() => run(p, ["c"]));
    assert.equal(r.code, 1);
    assert.match(r.err.join("\n"), /expected a number/);
  } finally {
    if (prev === undefined) {
      delete process.env.CUTILS_TEST_N;
    } else {
      process.env.CUTILS_TEST_N = prev;
    }
  }
});

test("kebab-case option keys normalize to camelCase opts keys", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { "template-engine": str(), "dry-run": bool() },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--template-engine", "pug", "--dry-run"]));
  assert.equal(r.code, 0);
  assert.equal(seen.templateEngine, "pug");
  assert.equal(seen.dryRun, true);
  assert.equal("template-engine" in seen, false);
});

test("camelCase collision (x-y + xY) throws at command()", () => {
  assert.throws(
    () =>
      command("c", {
        options: { "x-y": str(), xY: str() },
        handler: () => {},
      }),
    /share opts key/,
  );
});

test("hidden options and commands are omitted from help", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { secret: { flag: true, hidden: true }, open: { flag: true } },
        handler: () => {},
      }),
      ghost: command("ghost", { hidden: true, handler: () => {} }),
    },
  };
  const r = capture(() => run(p, ["c", "--help"]));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out.join("\n"), /secret/);
  assert.match(r.out.join("\n"), /--open/);
  const r2 = capture(() => run(p, ["--help"]));
  assert.doesNotMatch(r2.out.join("\n"), /ghost/);
});
