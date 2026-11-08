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

## Binary size (measured 2026-11-07, scriptc 0.4.7, darwin-arm64)

`scriptc build` default flags (pre-schema-first surface; re-measure if
quoting):

| program                                | bytes    |
| -------------------------------------- | -------- |
| argv-only baseline (hand-rolled `if`s) | 130,016  |
| one-command @cutils/cli demo (`greet`) | 456,088  |
| **library overhead**                   | +326,072 |

Reproduce: `test/size` is not shipped; rebuild the two programs described
in git history (`feat(cutils-cli)` commit message) or any equivalent
argv-only baseline vs `test/elf-app.ts`. No perf/size claims in the
README until a bench cell exists.

## Commands

- `pnpm build` / `pnpm test` — tsc + `node --test test/*.test.js` + `bash test/elf.test.sh`
- `scriptc coverage gate.ts` must report `compile statically (100%)` (via `scripts/scriptc-gate.sh`)
- `bash test/elf.test.sh` — builds `test/elf-app.ts`, runs the full matrix
  (flags, `--help`, `<cmd> --help`, `--version`, unknown command +
  suggestion, missing arg, bad value, schema rejection, builtin bounds)
