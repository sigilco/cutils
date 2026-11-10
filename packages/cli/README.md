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
declare function run<O, const A>(prog: ProgramSpec<O, A>, argv?: string[]): number;
declare function runAsync<O, const A>(prog: ProgramSpec<O, A>, argv?: string[]): Promise<number>;
declare function command<O, const A>(description: string, spec: CommandSpec<O, A>): CommandDef;
declare function str(extra?: BuiltinOpts): OptionSpec & { schema: TypedValidator<string> };
declare function num(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> };
declare function int(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> };
declare function bool(extra?: BuiltinOpts): OptionSpec & { flag: true; schema: TypedValidator<boolean> };
```

`run(prog)` reads `process.argv.slice(2)`; pass `argv` explicitly as a test seam or to embed a sub-CLI. `runAsync` is the async twin — it awaits Promise-returning handlers and Promise-returning validators: `runAsync(prog).then((c) => process.exit(c))`.

```ts
interface ProgramSpec<O, A> {
  name: string;
  version?: string;
  description?: string;
  args?: A;                            // root-level positionals
  options?: O;                         // root-level options
  schema?: SchemaInput;                // validates root { opts, args }
  handler?: (opts, args) => unknown;   // program action (single-command CLIs)
  commands?: Record<string, CommandDef>;
}

interface CommandSpec<O, A> {
  args?: A;                            // (string | ArgSpec)[], in order
  options?: O;                         // record of OptionSpec | schema | function
  schema?: SchemaInput;                // validates { opts, args }
  handler?: (opts: OptsFromOptions<O>, args: ArgsFromSpec<A>) => unknown;
  commands?: Record<string, CommandDef>;  // subcommand map → group node
  alias?: string | string[];
  hidden?: boolean;                    // omit from parent help
}

interface ArgSpec {
  name: string;
  optional?: boolean;   // absent → default else null (never undefined)
  variadic?: boolean;   // collects rest into an array slot (must be last)
  default?: unknown;    // absent-optional value, schema-validated
  description?: string;
  schema?: SchemaInput; // validates each element
}

interface OptionSpec {
  schema?: SchemaInput;   // absent = raw string passthrough
  flag?: boolean;         // consumes no value: --x / --x=false / -x
  optionalValue?: boolean;// --opt bare → true, --opt=v → "v" (no space form)
  variadic?: boolean;     // --tag a b / --tag a --tag b → per-element schema → O[]
  negatable?: boolean;    // flag only: --no-x parses to false
  short?: string;         // one character
  default?: unknown;      // run through validate() in command()
  env?: string;           // absent → process.env[env] when set
  description?: string;
  metavar?: string;       // help hint; defaults to the option name
  hidden?: boolean;       // omit from generated help
}
```

The program is a root command node: root `args`/`options`/`handler` make a single-command CLI, `commands` nests to any depth, and a group with a `handler` also runs as its own default action. Kebab-case option keys normalize `opts` to camelCase (`"template-engine"` → `opts.templateEngine`), matching commander.

### Parsing rules

| Input                                     | Result                                             |
| ----------------------------------------- | -------------------------------------------------- |
| `--upper`                                 | flag `true`                                        |
| `--upper=false` / `=0` / `=1`             | flag value through the validator → `false`         |
| `--no-x`                                  | negatable flag → `false`                           |
| `--times 3`, `--times=3`                  | raw `"3"` → validator's output (e.g. `3`)          |
| `--opt` / `--opt=v`                       | optionalValue → `true` / `"v"` (no space form)     |
| `--tag a b`, `--tag=a`, `--tag a --tag b` | variadic → `["a","b"]`, per-element schema → `O[]` |
| `-u`, `-t 3`, `-t3`, `-ut3`               | short flags; flag shorts cluster                   |
| `a b c` (leaf)                            | positionals → `args` slots; `...` tail → array     |
| `group leaf …`                            | first operand matching a subcommand/alias descends |
| `prog help <path…>`                       | prints that node's help                            |
| `--`                                      | end of options; rest are positionals               |
| `-h`                                      | node help unless `h` is a declared `short`         |

Option values may appear anywhere before `--`. Options before a subcommand token bind the parent; options after it belong to the child. A parent node's opts/args/schema all validate before descent.

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

## Migrating from commander

Coming from commander? The shape is mostly mechanical: one declarative spec instead of chained calls, schemas instead of `argParser`/`parseArg` callbacks, and `opts` inferred rather than `OptionValues`.

| commander                                  | @cutils/cli                                               | Migration notes                                        |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| `.option()` / `.argument()` chaining       | one `command()` literal                                   | declarative spec = the static schema; no mutation      |
| `opts` untyped (`OptionValues`)            | `opts` inferred from schemas via `types.output`           | the schema carries the type                            |
| absent option is `undefined`               | zero value, `default`, or `null` (optional args)          | no `\| undefined` unions in the subset                 |
| `<req>` / `[opt]` / `<v...>` args          | `"name"` / `{optional:true}` / `{variadic:true}` ArgSpecs | same arity model; schemas type each element            |
| variadic options `addOption`-style         | `{variadic: true}` — also repeatable (`--x a --x b`)      | per-element schema → `O[]`                             |
| `--opt [val]` optional values              | `{optionalValue: true}`                                   | bare → `true`, `=v` → `"v"`; no space form             |
| `.env()` fallback                          | `env: "VAR"` on the OptionSpec                            | env string still goes through `validate()`             |
| `--no-x` negated flags                     | `{flag: true, negatable: true}`                           | explicit, not automatic                                |
| `argParser` / `parseArg` processing        | `schema:` Standard-Schema seam                            | morphs cover coercion, collect, custom types           |
| subcommand trees (`.command().command()`)  | nested `commands:` records                                | options before the token bind the parent               |
| `.alias()`                                 | `alias: "a"` or `alias: [...]`                            | shows as `name\|alias` in help                         |
| `.action()` + `.parseAsync()`              | `handler` + `runAsync(prog)`                              | `run` is sync; async handlers/validators need runAsync |
| `process.exit` inside the framework        | `run`/`runAsync` return the code; caller exits            | testable under `node --test`, no hidden exits          |
| program action + program-level options     | `handler`/`options`/`args`/`schema` on `ProgramSpec`      | the program is a root command node                     |
| `help <cmd>`                               | `prog help <path…>` pseudo-command                        | walks the tree                                         |
| hooks (`preAction`, `postAction`)          | not built                                                 | command-level `schema` covers validation; hooks are v2 |
| `choices`/`conflicts`/`implies`/`preset`   | not built                                                 | schema / command-schema territory                      |
| `configureHelp`/`exitOverride`/executables | not built                                                 | fixed conventions; single-ELF model                    |

## Notes

- Parse throughput is benchmarked in `bench/apps` (Node: `node bench-node.mjs`; ELF: `bash bench-elf.sh`) — ~840k ops/s on an options parse vs commander's ~460k and `node:util.parseArgs`'s ~530k (measured 2026-11-08, Node 24, darwin-arm64). Binary size vs a hand-rolled argv baseline is measured and recorded in `packages/cli/AGENTS.md`.
- Requires Node >= 22 at dev/build time; the compiled ELF has no Node dependency.
