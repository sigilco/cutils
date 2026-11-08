# @cutils/cli

Type-first, declarative CLI builder authored inside the [scriptc](https://github.com/vercel-labs/scriptc) compilable subset — the command spec is a plain record literal, a mapped type carries the options into your handler, and `scriptc build` lowers the whole thing into the app's single static ELF. Zero dependencies; runs under Node unchanged.

```ts
import { command, run } from "@cutils/cli";

process.exit(
  run({
    name: "demo",
    version: "1.0.0",
    commands: {
      greet: command("greet someone", {
        args: ["name"],
        options: {
          upper: { type: "boolean", short: "u", description: "uppercase output" },
          times: { type: "number", short: "t", default: 1, description: "repeat n times" },
        },
        handler: (opts, args) => {
          // opts: { upper: boolean; times: number } — fully inferred
          const who = opts.upper ? args[0].toUpperCase() : args[0];
          for (let i = 0; i < opts.times; i++) console.log(`hello ${who}`);
        },
      }),
    },
  }),
);
```

- **The literal IS the schema.** Parse rules, `opts` types, `--help` tables, and error messages all come from the same `command()` spec — no runtime reflection (which scriptc cannot lower anyway).
- **`opts` is fully inferred.** The options literal flows through a mapped type: `{ type: "boolean" }` → `boolean`, `"number"` → `number`, `"string"` → `string`. Every declared key is always present.
- **Help, version, and errors are generated.** `--help`/`-h` at program and command level, `--version`, unknown-command suggestions, and labelled errors for missing arguments, unknown options, and bad values.
- **Standard Schema hook.** Any validator shaped like `schema["~standard"]` — or a whole schema object carrying one, like an arktype `Type` or a zod schema — can guard an option value or the whole `{ opts, args }` input. When the schema declares `types.output`, that type flows into `opts` (arktype literal unions infer as literal unions). Sync only — async validators are rejected with a clear error.
- **Exits by return code.** `run` prints and returns a number; it never calls `process.exit` itself, so it stays unit-testable under plain `node --test`.

## Surface

```ts
declare function run(prog: ProgramSpec, argv?: string[]): number;
declare function command<O extends Record<string, OptionSpec>>(
  description: string,
  spec: CommandSpec<O>,
): CommandDef;
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
  options?: O;                           // record of OptionSpec
  schema?: StandardSchemaInput;          // validates { opts, args }
  handler: (opts: OptsFromOptions<O>, args: string[]) => void;
}

interface OptionSpec {
  type: "boolean" | "string" | "number";
  short?: string;                        // one character
  default?: unknown;                     // must match `type`; checked in command()
  description?: string;
  schema?: StandardSchemaInput;          // validates the parsed option value
}

// StandardSchemaInput accepts three shapes: a bare { validate(value) },
// the "~standard" props object itself, or a whole schema object carrying
// "~standard" (arktype Type, zod schema). "~standard".validate wins when
// both paths exist; neither → E_BAD_OPTION at command() time.
```

### Parsing rules

| Input                         | Result                                        |
| ----------------------------- | --------------------------------------------- |
| `--upper`                     | boolean `true`                                |
| `--times 3`, `--times=3`      | number `3`; non-numeric → error               |
| `-u`, `-t 3`, `-t3`, `-ut3`   | short flags; boolean shorts cluster           |
| `--greeting hi`, `-g hi`      | string option                                 |
| `--upper=false` / `=0` / `=1` | explicit boolean value                        |
| `--`                          | end of options; rest are positionals          |
| `-h`                          | command help unless `h` is a declared `short` |

Option values may appear anywhere before `--`. Declared positionals are all required; extra positionals are an `unexpected argument` error.

### Defaults and `opts` presence

Every declared option key exists in `opts` with its declared type. When the flag is absent: the `default` if one was declared, else the type's zero value (`false`, `0`, `""`). There is no `undefined` member to check — use a sentinel `default` or a `schema` if "was it passed" matters.

### Standard Schema seam

`schema` accepts three shapes: a bare `{ validate(value) }` returning `{ value }` or `{ issues: [{ message }] }`; the `mySchema["~standard"]` props object itself; or a whole schema object carrying `"~standard"` — pass `myArktype` or `myZodSchema` directly and the builder unwraps it. `"~standard".validate` wins when both paths exist; a schema with neither fails at `command()` time with `E_BAD_OPTION`. Option schemas receive the parsed option value; command schemas receive `{ opts, args }`. Results are synchronous — a `Promise` return is an error, not a wait.

When the schema declares `types.output` (every Standard Schema library does — it is the spec's phantom type channel), `OptsFromOptions` uses it for `opts` instead of the primitive `type`: `type("'dev' | 'prod'")` gives `opts.env: "dev" | "prod"`. A schema output of `unknown` falls back to the `type`-derived primitive.

## Divergences from commander

| commander                                 | @cutils/cli                                                 | Why                                               |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `.option()` / `.argument()` chaining      | one `command()` literal                                     | declarative spec = the static schema; no mutation |
| `opts` untyped (`OptionValues`)           | `opts` inferred from the literal via mapped type            | the literal is the type                           |
| absent option is `undefined`              | zero value or declared `default`                            | no `\| undefined` unions in the subset            |
| variadic args, `[optional]` positionals   | required positionals only                                   | v0 scope; variadic is a v1 item                   |
| `process.exit` inside the framework       | `run` returns the code; caller exits                        | testable under `node --test`, no hidden exits     |
| async/`.action()` promise handlers        | sync handlers only                                          | `void \| Promise<void>` unions add dynamic slots  |
| zod etc. via `.parse` wrappers            | `schema:` Standard-Validator hook                           | async validators rejected; heavy schema libs stay |
|                                           |                                                             | Node-mode under scriptc's island limits           |
| automatic `-V` / help option registration | `-h`/`--help`/`--version` only, `-h` yields to `short: "h"` | small fixed set; user shorts win                  |
| subcommand trees                          | flat command map                                            | v2 item                                           |

## Notes

- No perf claims yet — binary size vs a hand-rolled argv baseline is measured and recorded in `packages/cli/AGENTS.md`.
- Requires Node >= 22 at dev/build time; the compiled ELF has no Node dependency.
