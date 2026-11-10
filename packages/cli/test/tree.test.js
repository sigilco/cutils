// Subcommand-tree and program-level node tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, command, int, run, str } from "../dist/esm/index.js";
import { capture } from "./helpers.js";

function tree(hit) {
  return {
    name: "t",
    version: "1.0.0",
    options: { verbose: bool({ short: "v" }) },
    commands: {
      deploy: command("deploy things", {
        commands: {
          web: command("deploy web", {
            options: { target: str() },
            handler: (opts) => hit.push(["web", opts]),
          }),
          api: command("deploy api", {
            alias: "a",
            handler: () => hit.push(["api"]),
          }),
        },
      }),
      status: command("show status", {
        handler: () => hit.push(["status"]),
      }),
    },
  };
}

test("descent: prog group leaf runs the leaf handler", () => {
  const hit = [];
  const r = capture(() => run(tree(hit), ["deploy", "web", "--target", "prod"]));
  assert.equal(r.code, 0);
  assert.deepEqual(hit, [["web", { target: "prod" }]]);
});

test("parent options before the subcommand token bind the parent", () => {
  const hit = [];
  // --verbose is a root option; it must not reach the child
  const r = capture(() => run(tree(hit), ["--verbose", "deploy", "web"]));
  assert.equal(r.code, 0);
  assert.deepEqual(hit[0][1], { target: "" });
});

test("options after the subcommand token belong to the child", () => {
  const hit = [];
  const r = capture(() => run(tree(hit), ["deploy", "web", "--verbose"]));
  assert.equal(r.code, 1); // web has no --verbose
  assert.match(r.err.join("\n"), /unknown option '--verbose'/);
});

test("alias invokes the command; help lists name|alias", () => {
  const hit = [];
  const r = capture(() => run(tree(hit), ["deploy", "a"]));
  assert.equal(r.code, 0);
  assert.deepEqual(hit, [["api"]]);
  const h = capture(() => run(tree(hit), ["deploy", "--help"]));
  assert.match(h.out.join("\n"), /api\|a/);
});

test("help pseudo-command walks the tree", () => {
  const r = capture(() => run(tree([]), ["help", "deploy", "web"]));
  assert.equal(r.code, 0);
  assert.match(r.out.join("\n"), /deploy web — deploy web/);
  assert.match(r.out.join("\n"), /--target/);
});

test("bare group with no handler prints group help, exit 0", () => {
  const r = capture(() => run(tree([]), ["deploy"]));
  assert.equal(r.code, 0);
  assert.match(r.out.join("\n"), /Usage: t deploy <command>/);
  assert.match(r.out.join("\n"), /deploy web/);
});

test("unknown subcommand under a group errors with suggestion", () => {
  const r = capture(() => run(tree([]), ["deploy", "wbe"]));
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /unknown command 'wbe'.*did you mean 'web'/);
});

test("program-level node: single-command CLI, no commands needed", () => {
  let seen;
  const p = {
    name: "solo",
    args: ["file"],
    options: { n: int({ min: 0 }) },
    handler: (opts, args) => {
      seen = [opts, args];
    },
  };
  const r = capture(() => run(p, ["--n", "3", "in.txt"]));
  assert.equal(r.code, 0);
  assert.deepEqual(seen, [{ n: 3 }, ["in.txt"]]);
  const miss = capture(() => run(p, []));
  assert.equal(miss.code, 1);
  assert.match(miss.err.join("\n"), /missing required argument 'file'/);
});

test("root -h yields to a declared short: 'h' option at root", () => {
  let seen;
  const p = {
    name: "d",
    options: { host: str({ short: "h" }) },
    handler: (opts) => {
      seen = opts;
    },
  };
  const r = capture(() => run(p, ["-h", "example.com"]));
  assert.equal(r.code, 0);
  assert.equal(seen.host, "example.com");
});

test("leaf command without a handler throws at command()", () => {
  assert.throws(() => command("c", { options: { x: str() } }), /requires a handler/);
});

test("deep nesting a → b → c", () => {
  const hit = [];
  const p = {
    name: "t",
    commands: {
      a: command("a", {
        commands: {
          b: command("b", {
            commands: {
              c: command("c", { handler: () => hit.push("deep") }),
            },
          }),
        },
      }),
    },
  };
  const r = capture(() => run(p, ["a", "b", "c"]));
  assert.equal(r.code, 0);
  assert.deepEqual(hit, ["deep"]);
});

test("group with its own handler runs as the default action", () => {
  const hit = [];
  const p = {
    name: "t",
    commands: {
      g: command("group", {
        handler: () => hit.push("group-default"),
        commands: {
          sub: command("sub", { handler: () => hit.push("sub") }),
        },
      }),
    },
  };
  capture(() => run(p, ["g"]));
  capture(() => run(p, ["g", "sub"]));
  assert.deepEqual(hit, ["group-default", "sub"]);
});

test("positional that matches a subcommand name descends, others bind args", () => {
  const hit = [];
  const p = {
    name: "t",
    commands: {
      run: command("run", {
        args: [{ name: "input", optional: true }],
        commands: {
          dry: command("dry run", { handler: () => hit.push(["dry"]) }),
        },
        handler: (_o, args) => hit.push(["run", args[0]]),
      }),
    },
  };
  capture(() => run(p, ["run", "file.txt"]));
  capture(() => run(p, ["run", "dry"]));
  assert.deepEqual(hit, [["run", "file.txt"], ["dry"]]);
});
