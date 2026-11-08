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

- `args` names required positionals, in order. Extra positionals are an `unexpected argument` error.
- `options` entries are `OptionSpec`, a whole schema object, or a bare `(v) => result` function — discriminated by `~standard`/`validate` presence (or `typeof === "function"`).
- `OptionSpec` has no `type`: `flag` (consumes no value) is the only parse fact; `schema` adds validation + typing; `short`, `default` (validated through `validate()` at `command()`), `description`, `metavar` (help hint, defaults to the name).
- Validators receive the raw argv string; the returned `value` is what `opts` gets — morphs apply to explicit values and defaults. Absent options: `default`, else `false` for flags / `""` for value-options — a schema that rejects `""` is effectively required.
- `str()`/`num()`/`int()`/`bool()` builtins are zero-dep Standard-Schema-shaped validators with `types.output` declared — `num({min, max})` both infers `opts.x: number` and enforces bounds.
- Foreign schemas plug straight in: `schema: myZod`, `schema: myArktype`, `schema: mySchema["~standard"]`, or drop a whole schema object in as the option entry itself. Async validators are rejected cleanly.
- Parsing: `--opt`, `--opt=v`, `--opt v`, `-s`, `-s v`, `-sV`, clustered flag shorts (`-ut3`), `--flag=false`, `--` end-of-options, `-h` (yields to a declared `short: "h"`).
- Generated: `--help`/`-h` at program and command level, `--version`, unknown-command suggestions, labelled errors.
- `run` returns the exit code and never exits itself: `process.exit(run({...}))`, or pass `argv` as a test seam.

See the [package README](https://github.com/sigilco/cutils/tree/main/packages/cli#readme) for the full surface and the commander divergence table.
