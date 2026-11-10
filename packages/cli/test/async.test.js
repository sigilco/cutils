// Async handler / async validator tests for runAsync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, run, runAsync, str } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

function captureAsync(fn) {
  const out = [];
  const err = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (m) => out.push(String(m));
  console.error = (m) => err.push(String(m));
  return fn()
    .then((code) => ({ code, out, err }))
    .finally(() => {
      console.log = ol;
      console.error = oe;
    });
}

test("runAsync awaits an async handler", async () => {
  let done = false;
  const p = {
    name: "d",
    commands: {
      slow: command("slow", {
        handler: async () => {
          await new Promise((r) => setTimeout(r, 5));
          done = true;
        },
      }),
    },
  };
  const r = await captureAsync(() => runAsync(p, ["slow"]));
  assert.equal(r.code, 0);
  assert.equal(done, true);
});

test("run() rejects a Promise-returning handler with a clear error", () => {
  const p = {
    name: "d",
    commands: {
      slow: command("slow", { handler: async () => {} }),
    },
  };
  const r = capture(() => run(p, ["slow"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /runAsync/);
});

test("runAsync awaits async validators (options and command schema)", async () => {
  let seen;
  const asyncV = {
    validate: async (v) => ({ value: "validated:" + v }),
  };
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { when: asyncV },
        schema: {
          validate: async (input) => ({ value: input }),
        },
        handler: (opts) => {
          seen = opts;
        },
      }),
    },
  };
  const r = await captureAsync(() => runAsync(p, ["c", "--when", "later"]));
  assert.equal(r.code, 0);
  assert.equal(seen.when, "validated:later");
});

test("run() still rejects async validators", () => {
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        options: { when: { validate: async (v) => ({ value: v }) } },
        handler: () => {},
      }),
    },
  };
  const r = capture(() => run(p, ["c", "--when", "x"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /async validators are not supported/);
});

test("async handler rejection propagates out of runAsync", async () => {
  const p = {
    name: "d",
    commands: {
      boom: command("boom", {
        handler: async () => {
          throw new Error("kaboom");
        },
      }),
    },
  };
  await assert.rejects(() => runAsync(p, ["boom"]), /kaboom/);
});

test("runAsync handles a fully-sync program identically to run", async () => {
  let seen;
  const p = {
    name: "d",
    commands: {
      c: command("c", {
        args: ["x"],
        options: { s: str() },
        handler: (opts, args) => {
          seen = [opts, args];
        },
      }),
    },
  };
  const r = await captureAsync(() => runAsync(p, ["c", "--s", "v", "arg"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, [{ s: "v" }, ["arg"]]);
});

test("runAsync descends subcommand trees", async () => {
  let hit;
  const p = {
    name: "d",
    commands: {
      g: command("g", {
        commands: {
          leaf: command("leaf", {
            handler: async () => {
              await Promise.resolve();
              hit = true;
            },
          }),
        },
      }),
    },
  };
  const r = await captureAsync(() => runAsync(p, ["g", "leaf"]));
  assert.equal(r.code, 0);
  assert.equal(hit, true);
});
