// Standard-Schema seam tests: bare validators, "~standard" props objects,
// and whole schema objects (the arktype Type / zod shape) all run before
// the handler; sync failures become errors, async validators are rejected
// cleanly, and a schema with no validate path fails at construction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, run } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

const range = (max) => ({
  validate: (value) => {
    if (typeof value === "number" && value > max) {
      return { issues: [{ message: `must be <= ${max}` }] };
    }
    return { value };
  },
});

test("option schema passes valid values through", () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { times: { type: "number", schema: range(10) } },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--times", "5"]));
  assert.equal(r.code, 0);
  assert.equal(seen.times, 5);
});

test("option schema rejects with its issue messages", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { times: { type: "number", schema: range(10) } },
        handler: () => assert.fail("handler must not run"),
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--times", "99"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /--times: validation failed; must be <= 10/);
});

test("command schema receives { opts, args } and runs before the handler", () => {
  let input;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["name"],
        options: { upper: { type: "boolean", short: "u" } },
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
  assert.match(r.err.join("\n"), /c: validation failed; cannot greet root/);
});

test("async option validator is rejected cleanly", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: {
          times: {
            type: "number",
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
        options: { greeting: { type: "string", schema: std } },
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
      validate: (value) =>
        value === "ok" ? { value } : { issues: [{ message: "must be ok" }] },
      types: { input: undefined, output: undefined },
    },
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { mode: { type: "string", schema: whole } },
        handler: () => {},
      }),
    },
  };
  const ok = capture(() => run(p, ["c", "--mode", "ok"]));
  const bad = capture(() => run(p, ["c", "--mode", "no"]));
  assert.equal(ok.code, 0);
  assert.equal(bad.code, 1);
  assert.match(bad.err.join("\n"), /--mode: validation failed; must be ok/);
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
        options: { x: { type: "string", schema: both } },
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
        options: { x: { type: "string", schema: { types: {} } } },
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
