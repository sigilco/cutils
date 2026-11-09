# @cutils/cli AGENTS.md

Standard-Schema-first CLI builder in the scriptc subset — the library owns
only the seam (argv tokenize → flag-vs-value → `validate` boundary →
dispatch/help/errors); all value semantics live in whatever schema the
consumer brings. Plain records + functions, no classes, zero deps. Design
source: `.agents/plans/2026-11-08-cli-schema-first.md` (supersedes the
`type`-field design in `.agents/plans/2026-11-07-cutils-cli.md`). Same
subset rules as the root AGENTS.md, plus what authoring this package
verified empirically under the pinned scriptc (0.4.7):

## Verified-OK constructs (probed by gate.ts at 100%)

- **Generic functions over record literals**: `command<O extends
Record<string, OptionInput>>` lowers fully — the generic only feeds the
  type-level `OptsFromOptions<O>` mapped type; nothing generic survives
  into runtime values.
- **Union-typed options entries**: `OptionInput = OptionSpec |
StandardSchemaInput | ValidateFn` — declared in the generic param only,
  erased; runtime discriminates via `isSchemaValue` (`typeof ===
"function"` or `~standard`/`validate` member present).
- **Function values inside records** AND a **bare function as an options
  entry** (`mark: (v) => ({value: v})`): both lower — the records are
  produced/consumed inside one program, never class fields.
- **Validator closures capturing builtin params**: `num({min,max})` /
  `int({min,max})` close over `lo`/`hi` — ordinary closures lower.
- **`Object.entries` + dynamic record WRITES**: every lookup walks
  `Object.entries()` with an indexed loop (`findLong`/`findShort`/
  `valueOf`/command dispatch); `values[name] = v` writes are legal.
  Dynamic record READS `obj[key]` remain SC1090 — never index a record.
- **`instanceof Promise`** narrows validator results; async validators are
  rejected with a clean error.
- **`process.exit`** lowers (elf-app exits with `run`'s return code).
- **`Number.isNaN`, `Number.isInteger`, `Number()`, `String(unknown)`** all
  lower — the last two land in the _dynamic tier_ (still static-compiled,
  runtime-checked).

## Rules specific to this package

- **One dynamic-slot trap survived**: `const h = spec.handler` holds a
  value declared `(opts: OptsFromOptions<O>, ...) => void` — a generic
  mapped type has no static lowering → SC6104 dynamic slot. Fix is the
  upcast in `command()`: `spec.handler as (opts: unknown, args: string[])
=> void` stores the boundary-typed function directly (also saves a
  wrapper closure). If you touch `command()`'s return path, re-run
  `scriptc coverage gate.ts --explain-dynamic` — zero `dynamic slots`
  lines is the bar (dynamic TIER statements are expected and fine).
- **`opts` typing is `types.output` only** — there is no `type` field to
  fall back to. Priority in `OptsFromOptions`: bare-schema entry →
  `SchemaOutput<O[K]>`; `{schema: S}` → `SchemaOutput<S>` (no `types` →
  `unknown`); `{flag: true}` → `boolean`; else `string`.
- **`TypedValidator<O>` is the typed-validator contract**: `types?: {input?,
output: O}` — `output` must be a REQUIRED member, matching the Standard
  Schema spec; `SchemaOutput`'s `{output: infer O}` pattern never matches
  an optional one (this burned once — `output?: O` silently gave `unknown`).
- **`default` goes through `validate()`** at `command()` time — issues →
  `E_BAD_OPTION` with the schema's message; a morph output is stored.
  Schema-less defaults get a cheap typeof check (flag→boolean, else→string).
- **Values are raw strings until a validator says otherwise**: the parser
  stores the argv string (or `true`/attached for flags); the end-of-parse
  pass runs `validateValue` per option and stores the OUTPUT — morphs
  apply. `num()`/`int()` do `Number()` inside their `validate`.
- **Schema-less flag attached values** (`--flag=false`): `true`/`1`→true,
  `false`/`0`→false, else error — done in the validation pass, not the
  parse loop.
- **`opts` keys are always present**: absent flag → `default` else the
  zero value (`false`/`""`). A schema that rejects `""` makes its option
  effectively required — document via `default`.
- **`run` never exits**: returns the code; `process.exit(run({...}))` is
  the consumer idiom. Keeps `node --test` tests in-process.
- **`-h` yields to a declared `short: "h"`** — check `findShort` before
  printing command help.
- **Help/errors go through `console.log`/`console.error`** — no
  `process.stdout` writes or patching (patching is a subset ban).

## Binary size (measured 2026-11-08, scriptc 0.4.7, darwin-arm64)

`scriptc build` default flags, `bench/apps/` cells (argv-baseline is a
hand-rolled equivalent app — bigger than the old 130,016 baseline because
it parses more forms):

| program                 | bytes   | delta vs baseline |
| ----------------------- | ------- | ----------------- |
| argv-baseline           | 375,888 | —                 |
| cli-basic (one command) | 793,640 | +417,752          |
| cli-full (all v1)       | 980,216 | +604,328          |

Tree-shaking works but is per-feature, not per-function: cli-full pays for
the descent machinery cli-basic already carries; the extra ~187 KB is the
variadic/optionalValue/env/negatable/async arms of the shared parse loop.
Reproduce: `bash bench/apps/bench-elf.sh`.

## Parse throughput (measured 2026-11-08, Node 24, darwin-arm64)

`bench/apps/bench-node.mjs` — ops/sec, spec built once outside the loop:

| cell                | ops/sec     |
| ------------------- | ----------- |
| @cutils/cli options | ~840,000    |
| commander options   | ~460,000    |
| node:util.parseArgs | ~527,000    |
| hand-rolled argv    | ~23,300,000 |
| @cutils/cli subtree | ~1,254,000  |
| commander subtree   | ~627,000    |

## New traps from the v1 surface (all probed by gate.ts)

- **`as string[]` on a record-read value copies under scriptc**: reading a
  `string[]` out of `Record<string, unknown>` then mutating through the
  cast silently loses writes in the ELF (Node keeps the reference).
  `pushVar` re-stores after every push — mutate-then-store, never
  cast-and-mutate. Caught by the ELF smoke, invisible to coverage.
- **Generic ProgramSpec<O,A> is a dynamic slot like the handler was**: any
  use of `prog` before the `as ProgramHead` / concrete-instantiation
  `as ProgramSpec<Record<...>, ArgInput[]>` casts is SC6104. Both casts
  happen at the top of `run`/`runAsync`; keep them.
- **`process.env[name]` reads lower** (dynamic tier only) — `env:` option
  fallback relies on this.
- **async lowers fully** (fn decls, arrows in records, `await`,
  `instanceof Promise`, `.then`) — `runNodeAsync`/`assignArgsAsync`/
  `validateOptsAsync`/`validateValueAsync`/`finishNodeAsync` duplicate the
  sync loop because `await` is lexical; do not merge them behind a union
  return (`number | Promise<number>` re-poisons the boundary).
- **Recursive records are fine**: `CommandDef.commands:
Record<string, CommandDef>` + iterative descent — no record unions.
- **`const A` generic infers the args tuple** at `command()`/`run()` call
  sites; `ArgsFromSpec`'s `number extends A["length"]` guard keeps plain
  `string[]` annotations on the legacy shape.
- **SC9001 `field ... is nullT` when consuming dist JS**: type-erased
  `field: null` initializers degenerate; in-repo scriptc apps import
  `src/index.ts` (gate, elf-app, bench/apps all do). The npm `./elf` entry
  story for consumers is a known TODO — mirror packages/sqlite when done.

## Commands

- `pnpm build` / `pnpm test` — tsc + `node --test test/*.test.js` + `bash test/elf.test.sh`
- `scriptc coverage gate.ts` must report `compile statically (100%)` (via `scripts/scriptc-gate.sh`)
- `bash test/elf.test.sh` — builds `test/elf-app.ts`, runs the full matrix
  (flags, `--help`, `<cmd> --help`, `--version`, unknown command +
  suggestion, missing arg, bad value, schema rejection, builtin bounds,
  variadic/optional positionals, optionalValue/negatable/env options,
  subcommand descent + alias + `help` walk, async handler via runAsync)
