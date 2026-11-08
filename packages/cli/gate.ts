// scriptc coverage gate — exercises the full @cutils/cli public surface.
// scripts/scriptc-gate.sh requires `compile statically (100%)` here.
//
// Constructs this gate probes (each was suspect under older scriptc pins;
// all must stay at 100% under the pinned release):
//   - generic function command<O extends Record<string, OptionInput>> with a
//     mapped-type handler parameter (OptsFromOptions over schema outputs)
//   - function values inside record literals (handler, schema.validate) and
//     a bare-function options entry (ValidateFn union arm)
//   - builtin factories num()/int()/bool()/str() — validator closures
//     capturing bound params (min/max)
//   - a bare whole-schema object as an options entry (isSchemaValue
//     discrimination: "~standard" member present)
//   - Object.entries over Record<string, OptionDef>/CommandDef for all
//     lookups (dynamic record reads are SC1090)
//   - instanceof Promise narrowing on a validator result
//   - Number.isNaN, Number.isInteger, startsWith-free substring compares,
//     process.argv slice, typeof checks on unknown values

import { bool, command, int, num, run, str } from "./src/index.ts";
import type {
  CommandDef,
  OptionSpec,
  ParsedInput,
  ProgramSpec,
  StandardResult,
  StandardValidator,
  TypedValidator,
  ValidationIssue,
} from "./src/index.ts";

// A hand-rolled validator carrying the phantom types.output channel —
// morphs the raw argv string into a number.
const noBigTimes: TypedValidator<number> = {
  validate: (value: unknown): StandardResult => {
    const n = Number(value);
    if (Number.isNaN(n)) {
      const bad: ValidationIssue[] = [{ message: "not a number" }];
      return { issues: bad };
    }
    if (n > 10) {
      const issues: ValidationIssue[] = [{ message: "times too large" }];
      return { issues: issues };
    }
    return { value: n };
  },
  types: { output: 0 },
};

const asyncValidator: StandardValidator = {
  validate: (value: unknown): Promise<StandardResult> => {
    return Promise.resolve({ value: value });
  },
};

// A whole schema object in the "~standard" carrier shape — used as a bare
// options entry (no OptionSpec wrapper).
const onlyOk = {
  "~standard": {
    validate: (value: unknown): StandardResult => {
      if (value === "ok") {
        return { value: value };
      }
      const issues: ValidationIssue[] = [{ message: "must be ok" }];
      return { issues: issues };
    },
    types: { input: "", output: "" as "ok" },
  },
};

// OptionSpec and ParsedInput are part of the public surface too.
const optSpec: OptionSpec = { flag: true, short: "x" };
const parsed: ParsedInput = { opts: { x: "y" }, args: ["y"] };

const prog: ProgramSpec = {
  name: "demo",
  version: "1.0.0",
  description: "gate demo",
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: bool({ short: "u", description: "uppercase" }),
        times: { short: "t", default: 1, description: "repeat", schema: noBigTimes },
        greeting: str({ short: "g", description: "greeting word" }),
        count: num({ default: 0, min: 0, max: 99 }),
        level: int({ default: 1, min: 1, max: 5 }),
        mark: (value: unknown): StandardResult => {
          return { value: String(value) + "!" };
        },
      },
      schema: {
        validate: (value: unknown): StandardResult => {
          return { value: value };
        },
      },
      handler: (opts, args) => {
        // opts is { upper: boolean; times: number; greeting: string;
        // count: number; level: number; mode: "ok"; mark: unknown } —
        // every member's type comes from its schema's types.output.
        const shout: boolean = opts.upper;
        const n: number = opts.times;
        const g: string = opts.greeting;
        const c: number = opts.count;
        const lv: number = opts.level;
        const u: unknown = opts.mark;
        void c;
        void lv;
        void u;
        let who = args[0];
        if (shout) {
          who = who.toUpperCase();
        }
        for (let i = 0; i < n; i++) {
          console.log(g + " " + who);
        }
      },
    }),
    check: command("check a bare schema entry", {
      options: {
        mode: onlyOk, // bare whole-schema object — the option IS the schema
      },
      handler: (opts, _args) => {
        const m: "ok" = opts.mode;
        console.log("mode " + m);
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
code += run(prog, ["greet", "--upper=false", "world"]);
code += run(prog, ["greet", "--times=2", "--greeting", "hi", "world"]);
code += run(prog, ["check", "--mode", "ok"]); // bare-schema entry, required
code += run(prog, ["check"]); // bare-schema absent → "must be ok" error
code += run(prog, ["check", "--mode", "no"]); // bare-schema rejection
code += run(prog, ["greet", "--", "-strange"]);
code += run(prog, ["add", "1.5", "2.5"]);
code += run(prog, ["greet"]); // missing required argument
code += run(prog, ["greet", "a", "b"]); // unexpected extra
code += run(prog, ["greet", "--times", "abc", "x"]); // bad number (validator)
code += run(prog, ["greet", "--bogus", "x"]); // unknown option
code += run(prog, ["gret", "x"]); // unknown command + suggestion
code += run(prog, ["greet", "--times", "99", "x"]); // schema rejection
code += run(prog, ["greet", "--count", "200", "x"]); // builtin bound rejection
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
