# @cutils/cli

Declarative CLI builder authored inside the [scriptc](https://github.com/vercel-labs/scriptc) compilable subset — the command spec is a plain record literal, and `scriptc build` lowers the whole thing into the app's single static ELF. Zero dependencies; runs under Node unchanged.

The library owns exactly one thing — the **seam**: argv tokenize → flag-vs-value → effective value → the [Standard Schema](https://standardschema.dev) `validate` boundary → `{opts, args}` → dispatch, help, errors, exit code. Every value semantic — coercion, constraints, literal unions, morphs — belongs to the schema you bring (zod, arktype, valibot, or a hand-rolled `{validate}`). `opts` typing derives entirely from Standard Schema's `types.output` phantom channel; an option without a schema is a raw string, which is just the truth about argv.

```ts
import { bool, command, int, run, str } from "@cutils/cli";

process.exit(
  run({
    name: "demo",
    version: "1.0.0",
    commands: {
      greet: command("greet someone", {
        args: ["name"],
        options: {
          upper: bool({ short: "u", description: "uppercase output" }),
          times: int({ short: "t", default: 1, max: 10, description: "repeat n times" }),
          greeting: str({ short: "g", description: "greeting word" }),
        },
        handler: (opts, args) => {
          // opts: { upper: boolean; times: number; greeting: string } — fully inferred
          const who = opts.upper ? args[0].toUpperCase() : args[0];
          for (let i = 0; i < opts.times; i++) console.log(`${opts.greeting || "hello"} ${who}`);
        },
      }),
    },
  }),
);
```

- **No `type` field.** `flag` is the only parse fact the library owns; everything else is schema. `opts` types come 100% from `types.output` — bring arktype/zod and literal unions, branded types, morphs all flow through.
- **Schemas everywhere or nowhere.** `schema` is optional per option and accepts four shapes: a bare `{validate}`, a `(v) => result` function, the `mySchema["~standard"]` props object, or a whole schema object (an arktype `Type`, a zod schema). A bare schema object also works _as_ the option entry itself.
- **Validated output is what `opts` gets.** Validators receive the raw argv string and return the parsed value — morphs apply to explicit values _and_ to `default`s, which are run through `validate()` at `command()` time.
- **Zero-dep primitives built in.** `str()`, `num()`, `int()`, `bool()` are tiny Standard-Schema-shaped validators with the `types` phantom declared — `num({min:0, max:99})` infers `opts.x: number` and validates, no library required.
- **Exits by return code.** `run` prints and returns a number; it never calls `process.exit` itself, so it stays unit-testable under plain `node --test`.

## Surface

```ts
declare function run(prog: ProgramSpec, argv?: string[]): number;
declare function command<O extends Record<string, OptionInput>>(
  description: string,
  spec: CommandSpec<O>,
): CommandDef;
declare function str(extra?: BuiltinOpts): OptionSpec & { schema: TypedValidator<string> };
declare function num(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> };
declare function int(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> };
declare function bool(extra?: BuiltinOpts): OptionSpec & { flag: true; schema: TypedValidator<boolean> };
```

`run(prog)` reads `process.argv.slice(2)`; pass `argv` explicitly as a test seam or to embed a sub-CLI.

```ts
interface ProgramSpec {
  name: string;
  version?: string;
  description?: string;
  commands: Record<string, CommandDef>;
}

interface CommandSpec<O> {
  args?: string[];                       // required positionals, in order
  options?: O;                           // record of OptionSpec | schema | function
  schema?: SchemaInput;                  // validates { opts, args }
  handler: (opts: OptsFromOptions<O>, args: string[]) => void;
}

interface OptionSpec {
  schema?: SchemaInput;                  // absent = raw string passthrough
  flag?: boolean;                        // consumes no value: --x / --x=false / -x
  short?: string;                        // one character
  default?: unknown;                     // run through validate() in command()
  description?: string;
  metavar?: string;                      // help hint: --name <metavar>; defaults to the name
}

// SchemaInput = StandardSchemaInput | ValidateFn — a bare validator, the
// "~standard" props object, a whole schema object, or a (v) => result fn.
// OptsFromOptions reads types.output: bare schema → declared output;
// { schema } → declared output (or unknown); { flag } → boolean; else → string.
```

### Parsing rules

| Input                         | Result                                        |
| ----------------------------- | --------------------------------------------- |
| `--upper`                     | flag `true`                                   |
| `--upper=false` / `=0` / `=1` | flag value through the validator → `false`    |
| `--times 3`, `--times=3`      | raw `"3"` → validator's output (e.g. `3`)     |
| `-u`, `-t 3`, `-t3`, `-ut3`   | short flags; flag shorts cluster              |
| `--greeting hi`, `-g hi`      | string option                                 |
| `--`                          | end of options; rest are positionals          |
| `-h`                          | command help unless `h` is a declared `short` |

Option values may appear anywhere before `--`. Declared positionals are all required; extra positionals are an `unexpected argument` error.

### Defaults and `opts` presence

Every declared option key exists in `opts`. When the flag is absent: the `default` if one was declared (already validated and morphed at `command()` time), else `false` for flags / `""` for value-options. A schema on a value-option therefore sees `""` for absent input — a schema that rejects `""` makes its option effectively required; declare a `default` to keep it optional. Schema-less options check `default` cheaply (flag → boolean, else → string).

### Custom validators

The seam is one interface:

```ts
interface CliValidator<I, O> {           // i.e. StandardValidator
  validate(value: unknown): StandardResult | Promise<StandardResult>;
  types?: { input?: I; output?: O };     // phantom — never read at runtime
}
```

Declare `types.output` on a hand-rolled validator and `opts` picks it up — no library needed:

```ts
const port: TypedValidator<number> = {
  validate: (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? { issues: [{ message: `expected a number` }] } : { value: n };
  },
  types: { output: 0 },
};
options: { port: { schema: port } }  // opts.port: number
```

Async validators are rejected with a clear error — `Promise` results are never awaited.

## Divergences from commander

| commander                                 | @cutils/cli                                                 | Why                                               |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `.option()` / `.argument()` chaining      | one `command()` literal                                     | declarative spec = the static schema; no mutation |
| `opts` untyped (`OptionValues`)           | `opts` inferred from schemas via `types.output`             | the schema carries the type                       |
| absent option is `undefined`              | zero value or declared `default`                            | no `\| undefined` unions in the subset            |
| variadic args, `[optional]` positionals   | required positionals only                                   | v0 scope; variadic is a v1 item                   |
| `process.exit` inside the framework       | `run` returns the code; caller exits                        | testable under `node --test`, no hidden exits     |
| async/`.action()` promise handlers        | sync handlers only                                          | `void \| Promise<void>` unions add dynamic slots  |
| zod etc. via `.parse` wrappers            | `schema:` Standard-Schema seam                              | async validators rejected; heavy schema libs stay |
|                                           |                                                             | Node-mode under scriptc's island limits           |
| automatic `-V` / help option registration | `-h`/`--help`/`--version` only, `-h` yields to `short: "h"` | small fixed set; user shorts win                  |
| subcommand trees                          | flat command map                                            | v2 item                                           |

## Notes

- No perf claims yet — binary size vs a hand-rolled argv baseline is measured and recorded in `packages/cli/AGENTS.md`.
- Requires Node >= 22 at dev/build time; the compiled ELF has no Node dependency.
