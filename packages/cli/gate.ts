// scriptc coverage gate — exercises the full @cutils/cli public surface.
// scripts/scriptc-gate.sh requires `compile statically (100%)` here.
//
// Constructs this gate probes (each was suspect under older scriptc pins;
// all must stay at 100% under the pinned release):
//   - generic function command<O extends Record<string, OptionSpec>> with a
//     mapped-type handler parameter (OptsFromOptions)
//   - function values inside record literals (handler, schema.validate)
//   - Object.entries over Record<string, OptionDef>/CommandDef for all
//     lookups (dynamic record reads are SC1090)
//   - instanceof Promise narrowing on a validator result
//   - Number.isNaN, startsWith-free substring compares, process.argv slice

import { command, run } from "./src/index.ts";
import type {
  CommandDef,
  OptionSpec,
  ParsedInput,
  ProgramSpec,
  StandardResult,
  StandardValidator,
  ValidationIssue,
} from "./src/index.ts";

// A hand-rolled Standard-Schema-shaped sync validator.
const noBigTimes: StandardValidator = {
  validate: (value: unknown): StandardResult => {
    if (typeof value === "number" && value > 10) {
      const issues: ValidationIssue[] = [{ message: "times too large" }];
      return { issues: issues };
    }
    return { value: value };
  },
};

const asyncValidator: StandardValidator = {
  validate: (value: unknown): Promise<StandardResult> => {
    return Promise.resolve({ value: value });
  },
};

// OptionSpec and ParsedInput are part of the public surface too.
const optSpec: OptionSpec = { type: "string", short: "x" };
const parsed: ParsedInput = { opts: { x: "y" }, args: ["y"] };

const prog: ProgramSpec = {
  name: "demo",
  version: "1.0.0",
  description: "gate demo",
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: { type: "boolean", short: "u", description: "uppercase" },
        times: {
          type: "number",
          short: "t",
          default: 1,
          description: "repeat",
          schema: noBigTimes,
        },
        greeting: { type: "string", description: "greeting word" },
      },
      schema: {
        validate: (value: unknown): StandardResult => {
          return { value: value };
        },
      },
      handler: (opts, args) => {
        // opts is { upper: boolean; times: number; greeting: string } —
        // the mapped type, proven by the typed uses below.
        const shout: boolean = opts.upper;
        const n: number = opts.times;
        const g: string = opts.greeting;
        let who = args[0];
        if (shout) {
          who = who.toUpperCase();
        }
        for (let i = 0; i < n; i++) {
          console.log(g + " " + who);
        }
      },
    }),
    add: command("add numbers", {
      args: ["a", "b"],
      handler: (_opts, args) => {
        console.log(String(Number(args[0]) + Number(args[1])));
      },
    }),
    slow: command("async schema command", {
      schema: asyncValidator,
      handler: (_opts, _args) => {
        console.log("unreachable");
      },
    }),
  },
};

// Full validation matrix through the public API.
let code = 0;
code += run(prog, ["--help"]);
code += run(prog, ["--version"]);
code += run(prog, ["greet", "--help"]);
code += run(prog, ["greet", "-u", "world"]);
code += run(prog, ["greet", "--times=2", "--greeting", "hi", "world"]);
code += run(prog, ["greet", "--", "-strange"]);
code += run(prog, ["add", "1.5", "2.5"]);
code += run(prog, ["greet"]); // missing required argument
code += run(prog, ["greet", "a", "b"]); // unexpected extra
code += run(prog, ["greet", "--times", "abc", "x"]); // bad number
code += run(prog, ["greet", "--bogus", "x"]); // unknown option
code += run(prog, ["gret", "x"]); // unknown command + suggestion
code += run(prog, ["greet", "--times", "99", "x"]); // schema rejection
code += run(prog, ["slow"]); // async validator rejection

// The CommandDef record is public: callers may compose specs by hand.
const raw: CommandDef = {
  description: "raw",
  args: [],
  options: {},
  schema: null,
  handler: (_opts: unknown, _args: string[]): void => {
    console.log("raw");
  },
};
const p2: ProgramSpec = { name: "p2", commands: { raw: raw } };
code += run(p2, ["raw"]);

if (code > 100 || optSpec.short === "zzz" || parsed.args.length === 99) {
  throw new Error("gate: unreachable");
}
