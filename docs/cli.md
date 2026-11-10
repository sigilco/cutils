# @cutils/cli

Declarative CLI builder in the scriptc-compilable subset — the same source runs under Node and lowers into a native ELF. Zero dependencies. It owns the seam only: argv → validated values → dispatch; all value semantics (coercion, constraints, morphs) belong to the [Standard Schema](https://standardschema.dev) you plug in.

## Quickstart

::: tabs

== tab Node

```sh
pnpm add @cutils/cli
```

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

== tab Native ELF

```sh
scriptc build src/main.ts -o demo
./demo greet -u -t2 world   # hello WORLD, twice
./demo greet --help         # generated usage + options table
```

:::

## How it works

The `command()` spec is a plain record literal. `OptsFromOptions` maps each options entry into the handler's `opts` parameter through Standard Schema's `types.output` channel — parse rules, types, `--help` output, and error messages all come from one static schema, no runtime reflection.

- The program is a root command node: `ProgramSpec` carries the same `args`/`options`/`schema`/`handler`/`commands` fields as every `command()` spec — a program can be a pure dispatcher, a single-command CLI (no `commands` needed), or both.
- `args` entries are `"name"` (required positional) or `ArgSpec` — `{name, optional, variadic, default, description, schema}`. Optional args absent → `default` else `null`; `variadic` (last only) collects the rest into an array slot; `schema` validates each element. Handler `args` is a mapped tuple via `ArgsFromSpec`.
- `options` entries are `OptionSpec`, a whole schema object, or a bare `(v) => result` function — discriminated by `~standard`/`validate` presence (or `typeof === "function"`).
- `OptionSpec`: `flag` (consumes no value), `optionalValue` (`--opt` bare → `true`, `--opt=v` → `"v"`), `variadic` (`--tag a b` / `--tag a --tag b` → `O[]`, per-element schema), `negatable` (flag: `--no-x` → `false`), `short`, `default` (validated at `command()`), `env` (`process.env` fallback), `description`, `metavar`, `hidden`.
- Kebab-case option keys normalize `opts` to camelCase (`"template-engine"` → `opts.templateEngine`).
- `commands` nests to any depth: a group is a `command()` whose spec has `commands` (handler optional — present = default action). Options before a subcommand token bind the parent; parent opts/args/schema validate before descent. `alias` adds invocation names (`name|alias` in help). `prog help <path…>` prints any node's help.
- Validators receive the raw argv string; the returned `value` is what `opts` gets — morphs apply to explicit values and defaults. Absent options: `default`, else `env`, else `false` for flags / `""` for value-options.
- `str()`/`num()`/`int()`/`bool()` builtins are zero-dep Standard-Schema-shaped validators with `types.output` declared.
- `run` is fully sync — async handlers or Promise-returning validators are clean errors pointing at `runAsync(prog)`, which awaits both. Entry idiom: `runAsync(prog).then((c) => process.exit(c))`.
- Parsing: `--opt`, `--opt=v`, `--opt v`, `-s`, `-s v`, `-sV`, clustered flag shorts (`-ut3`), `--flag=false`, `--no-x`, `--` end-of-options, `-h` (yields to a declared `short: "h"` at every level).
- Generated: `--help`/`-h` at every node, `--version` (root), unknown-command suggestions (aliases included), labelled errors.

See the [package README](https://github.com/sigilco/cutils/tree/main/packages/cli#readme) for the full surface and the commander migration table.
