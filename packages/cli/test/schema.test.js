// Standard-Schema seam tests: hand-rolled StandardValidator-shaped
// validators (the shape `schema["~standard"]` has) run before the handler,
// sync failures become errors, async validators are rejected cleanly.
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
