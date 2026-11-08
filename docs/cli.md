# @cutils/cli

Type-first, declarative CLI builder in the scriptc-compilable subset — the same source runs under Node and lowers into a native ELF. Zero dependencies.

## Quickstart

::: tabs

== tab Node

```sh
pnpm add @cutils/cli
```

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

== tab Native ELF

```sh
scriptc build src/main.ts -o demo
./demo greet -u -t2 world   # hello WORLD, twice
./demo greet --help         # generated usage + options table
```

:::

## How it works

The `command()` spec is a plain record literal. A mapped type (`OptsFromOptions`) carries the options literal into the handler's `opts` parameter, so parse rules, types, `--help` output, and error messages all come from one static schema — no runtime reflection anywhere.

- `args` names required positionals, in order. Extra positionals are an `unexpected argument` error.
- `options` accepts `boolean`/`string`/`number` with `short` (one character), `default` (must match `type`), and `description`. Every declared key is always present in `opts` — the `default`, else the type's zero value (`false`/`0`/`""`).
- Parsing: `--opt`, `--opt=v`, `--opt v`, `-s`, `-s v`, `-sV`, clustered boolean shorts (`-ut3`), `--` end-of-options, `-h` (yields to a declared `short: "h"`).
- Generated: `--help`/`-h` at program and command level, `--version`, unknown-command suggestions (edit distance ≤ 2 or prefix), labelled errors for missing arguments, unknown options, and bad values.
- `schema` on an option or command accepts a Standard-Schema-shaped validator (`mySchema["~standard"]`); sync only — a `Promise` result is a clear error.
- `run` returns the exit code and never exits itself: `process.exit(run({...}))`, or pass `argv` as a test seam.

See the [package README](https://github.com/sigilco/cutils/tree/main/packages/cli#readme) for the full surface and the commander divergence table.
