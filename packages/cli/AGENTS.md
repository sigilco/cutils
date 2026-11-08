# @cutils/cli AGENTS.md

Type-first declarative CLI builder in the scriptc subset — plain records +
functions, no classes, zero deps. Design source:
`.agents/plans/2026-11-07-cutils-cli.md` and the `minicli` prototype writeup
(`~/Downloads/scriptc-cli-compat-roadmap-and-design.md` Part 2). Same subset
rules as the root AGENTS.md, plus what authoring this package verified
empirically under the pinned scriptc (0.4.7):

## Verified-OK constructs (probed by gate.ts at 100%)

- **Generic functions over record literals**: `command<O extends
Record<string, OptionSpec>>` lowers fully — the generic only feeds the
  type-level `OptsFromOptions<O>` mapped type; nothing generic survives
  into runtime values.
- **Function values inside records**: `CommandDef.handler` and
  `StandardValidator.validate` members lower fine (the cache "function
  members degrade instantiation" rule does not apply to this shape —
  the records are produced/consumed inside one program, never class
  fields).
- **`Object.entries` + dynamic record WRITES**: every lookup walks
  `Object.entries()` with an indexed loop (`findLong`/`findShort`/
  `valueOf`/command dispatch); `values[name] = v` writes are legal.
  Dynamic record READS `obj[key]` remain SC1090 — never index a record.
- **`instanceof Promise`** narrows validator results; async validators are
  rejected with a clean error.
- **`process.exit`** lowers (elf-app exits with `run`'s return code).
- **`Number.isNaN`, `Number()`, `String(unknown)`** all lower — the last
  two land in the _dynamic tier_ (still static-compiled, runtime-checked).

## Rules specific to this package

- **One dynamic-slot trap survived**: `const h = spec.handler` holds a
  value declared `(opts: OptsFromOptions<O>, ...) => void` — a generic
  mapped type has no static lowering → SC6104 dynamic slot. Fix is the
  upcast in `command()`: `spec.handler as (opts: unknown, args: string[])
=> void` stores the boundary-typed function directly (also saves a
  wrapper closure). If you touch `command()`'s return path, re-run
  `scriptc coverage gate.ts --explain-dynamic` — zero `dynamic slots`
  lines is the bar (dynamic TIER statements are expected and fine).
- **`OptionSpec.default` is `unknown`**, not `boolean | string | number`:
  multi-type unions in record members are subset-fragile. `command()`
  runtime-checks the default against `type` at construction (`E_BAD_OPTION`).
- **The schema seam is structural, not StandardSchemaV1**: the official
  type's computed `"~standard"` key poisons `Object.entries` lowering.
  `StandardValidator`/`StandardResult`/`StandardSchemaInput` are
  hand-rolled structural twins — `schema` accepts a bare validator, the
  `"~standard"` props, or a whole schema object (arktype `Type`, zod);
  `normalizeSchema` prefers `"~standard".validate` and throws
  `E_BAD_OPTION` when neither path exists. `OptsFromOptions` reads the
  schema's `types.output` (Standard Schema's phantom channel) before
  falling back to the primitive `type` — verified 2026-11-08: arktype
  `type("'dev'|'prod'")` infers `opts.env: "dev" | "prod"` and validates
  under scriptc Node islands end-to-end.
- **`opts` keys are always present**: absent flag → `default` else the
  type's zero value (`false`/`0`/`""`). Documented because it differs
  from commander (`undefined`). "Was it passed" = sentinel default or
  schema.
- **`run` never exits**: returns the code; `process.exit(run({...}))` is
  the consumer idiom. Keeps `node --test` tests in-process.
- **`-h` yields to a declared `short: "h"`** — check `findShort` before
  printing command help.
- **Help/errors go through `console.log`/`console.error`** — no
  `process.stdout` writes or patching (patching is a subset ban).

## Binary size (measured 2026-11-07, scriptc 0.4.7, darwin-arm64)

`scriptc build` default flags:

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
  suggestion, missing arg, bad number, schema rejection)
