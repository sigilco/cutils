// Positional-arg spec tests: optional / variadic / schema'd positionals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, int, run } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

test("optional positional absent is null", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["req", { name: "opt", optional: true }],
        handler: (_o, args) => {
          seen = args;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "x"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, ["x", null]);
});

test("optional positional takes declared default", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [{ name: "opt", optional: true, default: "dflt" }],
        handler: (_o, args) => {
          seen = args;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, ["dflt"]);
});

test("variadic positional collects the rest into one slot", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["first", { name: "rest", variadic: true, optional: true }],
        handler: (_o, args) => {
          seen = args;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "a", "b", "c", "d"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, ["a", ["b", "c", "d"]]);
});

test("required variadic needs at least one element", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [{ name: "rest", variadic: true }],
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /missing required argument 'rest'/);
});

test("optional variadic absent is an empty array", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [{ name: "rest", variadic: true, optional: true }],
        handler: (_o, args) => {
          seen = args;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, [[]]);
});

test("arg schema validates and morphs each positional", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [
          { name: "n", schema: int().schema },
          { name: "rest", variadic: true, optional: true, schema: int().schema },
        ],
        handler: (_o, args) => {
          seen = args;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "5", "1", "2"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, [5, [1, 2]]);
});

test("arg schema rejection reports the arg name", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: [{ name: "n", schema: int().schema }],
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c", "nope"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /<n>: expected a number/);
});

test("variadic arg must be last — command() throws", () => {
  assert.throws(
    () =>
      command("c", {
        args: [{ name: "rest", variadic: true }, "tail"],
        handler: () => {},
      }),
    /must be last/,
  );
});

test("required arg after optional — command() throws", () => {
  assert.throws(
    () =>
      command("c", {
        args: [{ name: "opt", optional: true }, "req"],
        handler: () => {},
      }),
    /cannot follow an optional/,
  );
});

test("arg default goes through the schema at construction", () => {
  assert.throws(
    () =>
      command("c", {
        args: [{ name: "n", optional: true, default: "nan", schema: int().schema }],
        handler: () => {},
      }),
    /E_BAD_OPTION/,
  );
});
