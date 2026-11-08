// Standard-Schema seam tests: bare validators, "~standard" props objects,
// whole schema objects (the arktype Type / zod shape), and bare functions
// all run before the handler; validators receive the RAW argv string and
// their output is what lands in `opts`; sync failures become errors, async
// validators are rejected cleanly, and a schema with no validate path
// fails at construction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, num, run } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

const range = (max) => ({
  validate: (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) {
      return { issues: [{ message: `expected a number, got '${value}'` }] };
    }
    if (n > max) {
      return { issues: [{ message: `must be <= ${max}` }] };
    }
    return { value: n };
  },
});

test("option schema receives the raw string and its output lands in opts", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { times: { schema: range(10) } },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--times", "5"]));
  assert.equal(r.code, 0);
  assert.equal(seen.times, 5); // morphed: the number, not the string "5"
});

test("option schema rejects with its issue messages", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { times: { schema: range(10) } },
        handler: () => assert.fail("handler must not run"),
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--times", "99"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /--times: must be <= 10/);
});

test("a bare validate function is a schema entry too", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: {
          shout: (value) => ({ value: String(value).toUpperCase() }),
        },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--shout", "hi"]));
  assert.equal(r.code, 0);
  assert.equal(seen.shout, "HI");
});

test("a bare schema object works as the whole option entry", () => {
  const whole = {
    "~standard": {
      validate: (value) => (value === "ok" ? { value } : { issues: [{ message: "must be ok" }] }),
    },
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { mode: whole },
        handler: () => {},
      }),
    },
  };
  assert.equal(capture(() => run(p, ["c", "--mode", "ok"])).code, 0);
  const bad = capture(() => run(p, ["c", "--mode", "no"]));
  assert.equal(bad.code, 1);
  assert.match(bad.err.join("\n"), /--mode: must be ok/);
});

test("command schema receives { opts, args } and runs before the handler", () => {
  let input;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["name"],
        options: { upper: { flag: true, short: "u" } },
        schema: {
          validate: (value) => {
            input = value;
            return { value };
          },
        },
        handler: (opts, args) => {
          assert.deepEqual(args, input.args);
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "-u", "world"]));
  assert.equal(r.code, 0);
  assert.deepEqual(input.opts, { upper: true });
  assert.deepEqual(input.args, ["world"]);
});

test("command schema rejection stops the handler", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["name"],
        schema: {
          validate: (value) => {
            if (value.args[0] === "root") {
              return { issues: [{ message: "cannot greet root" }] };
            }
            return { value };
          },
        },
        handler: () => assert.fail("handler must not run"),
      }),
    },
  };
  const r = capture(() => run(p, ["c", "root"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /c: cannot greet root/);
});

test("command schema also accepts a bare function", () => {
  let input;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        schema: (value) => {
          input = value;
          return { value };
        },
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c"]));
  assert.equal(r.code, 0);
  assert.deepEqual(input.opts, {});
});

test("async option validator is rejected cleanly", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: {
          times: {
            schema: { validate: (v) => Promise.resolve({ value: v }) },
          },
        },
        handler: () => assert.fail("handler must not run"),
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--times", "1"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /async validators are not supported/);
});

test("a real Standard-Schema-shaped validator object fits the interface", () => {
  // What `zodSchema["~standard"]` looks like structurally.
  const std = {
    validate: (value) =>
      typeof value === "string" && value.length > 0
        ? { value }
        : { issues: [{ message: "expected non-empty string" }] },
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { greeting: { schema: std } },
        handler: () => {},
      }),
    },
  };
  const ok = capture(() => run(p, ["c", "--greeting", "hi"]));
  const bad = capture(() => run(p, ["c"])); // "" zero value fails the schema
  assert.equal(ok.code, 0);
  assert.equal(bad.code, 1);
  assert.match(bad.err.join("\n"), /expected non-empty string/);
});

test("a whole schema object's ~standard props are unwrapped and called", () => {
  // The arktype Type / zod schema shape: "~standard" carries validate +
  // the phantom types channel, no top-level validate exists.
  const whole = {
    "~standard": {
      validate: (value) => (value === "ok" ? { value } : { issues: [{ message: "must be ok" }] }),
      types: { input: undefined, output: undefined },
    },
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { mode: { schema: whole, default: "ok" } },
        handler: () => {},
      }),
    },
  };
  const ok = capture(() => run(p, ["c", "--mode", "ok"]));
  const bad = capture(() => run(p, ["c", "--mode", "no"]));
  const dflt = capture(() => run(p, ["c"])); // default "ok" validates
  assert.equal(ok.code, 0);
  assert.equal(bad.code, 1);
  assert.equal(dflt.code, 0);
  assert.match(bad.err.join("\n"), /--mode: must be ok/);
});

test("~standard.validate wins over a top-level validate when both exist", () => {
  const both = {
    validate: () => ({ issues: [{ message: "top-level should not run" }] }),
    "~standard": {
      validate: (value) => ({ value }),
    },
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { x: { schema: both, default: "y" } },
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--x", "anything"]));
  assert.equal(r.code, 0);
});

test("a schema with neither validate nor ~standard.validate throws E_BAD_OPTION", () => {
  assert.throws(
    () =>
      command("c", {
        options: { x: { schema: { types: {} } } },
        handler: () => {},
      }),
    /E_BAD_OPTION: --x schema has neither ~standard\.validate nor validate/,
  );
  assert.throws(
    () =>
      command("c", {
        schema: { "~standard": { types: {} } },
        handler: () => {},
      }),
    /E_BAD_OPTION: command schema has neither ~standard\.validate nor validate/,
  );
});

test("defaults go through the schema: bad default fails at construction", () => {
  assert.throws(
    () =>
      command("c", {
        options: { times: { schema: range(10), default: 99 } },
        handler: () => {},
      }),
    /E_BAD_OPTION: --times: must be <= 10/,
  );
});

test("defaults go through the schema: morph output becomes the default", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { times: { schema: range(10), default: "7" } }, // string default morphs to 7
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c"]));
  assert.equal(r.code, 0);
  assert.equal(seen.times, 7);
});

test("schema-less defaults must match the flag/string kind", () => {
  assert.throws(
    () => command("c", { options: { s: { default: 5 } }, handler: () => {} }),
    /E_BAD_OPTION.*must be a string/,
  );
  assert.throws(
    () => command("c", { options: { f: { flag: true, default: "x" } }, handler: () => {} }),
    /E_BAD_OPTION.*must be a boolean/,
  );
});

test("builtin bounds enforce min and max", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { port: num({ default: 8080, min: 1, max: 65535 }) },
        handler: () => {},
      }),
    },
  };
  assert.equal(capture(() => run(p, ["c", "--port", "80"])).code, 0);
  const lo = capture(() => run(p, ["c", "--port", "0"]));
  assert.equal(lo.code, 1);
  assert.match(lo.err.join("\n"), /expected a number >= 1, got 0/);
  const hi = capture(() => run(p, ["c", "--port", "99999"]));
  assert.equal(hi.code, 1);
  assert.match(hi.err.join("\n"), /expected a number <= 65535, got 99999/);
});
