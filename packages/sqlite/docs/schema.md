# Standard-Schema integration

`db.prepare(sql, schema)` accepts any [Standard Schema v1](https://standardschema.dev)
validator — the seam is `schema["~standard"].validate(input)`, nothing else
is touched. `@cutils/sqlite` ships a local mirror of the interface
(`StandardSchemaV1` / `StdProps` in `types.ts`) so it has no dependency on
`@standard-schema/spec`; conforming objects structurally satisfy it.

## Two directions of validation

`prepare` validates BOTH ways:

- **Write** — `run(params)` validates the bind record/tuple first; a failed
  validation throws `SqliteError` with `code: "VALIDATION"` before anything
  reaches SQLite. The _validated output_ is what gets bound (defaults and
  transforms apply).
- **Read** — `get`/`getOrNull`/`all` validate each row record; a failure
  throws `code: "VALIDATION"` mid-iteration.

`db.prepareRaw(sql)` and the per-call `*Raw` methods (`runRaw`, `getRaw`,
`allRaw`) skip validation entirely — use them for trusted SQL or when the
projection doesn't map to a schema.

## Example: @chttp/val

```ts
import * as v from "@chttp/val";

const Todo = v.strictObject({
  id: v.number(),
  title: v.string(),
  done: v.number(),
});

const ins = db.prepare(
  "INSERT INTO todos (title, done) VALUES (:title, :done)",
  v.strictObject({ title: v.string(), done: v.optional(v.number()) }),
);
ins.run({ title: "x" });           // `done` omitted → unbound → NULL/default

const sel = db.prepare("SELECT id, title, done FROM todos", Todo);
const rows = sel.all([]);          // each row validated through Todo
```

## Example: valibot

```ts
import * as v from "valibot";

const Todo = v.object({
  id: v.number(),
  title: v.string(),
  done: v.number(),
});

const sel = db.prepare("SELECT id, title, done FROM todos", Todo);
```

`test/wrapper.test.js` runs the SAME fixtures through both validators —
that's the seam's contract: any compliant implementation must work, so never
special-case a specific library.

## Failure reporting

Validation issues become `SqliteError(code: "VALIDATION")`; the message is a
compact summary (`path: expected/received`) built from the validator's
`issues` array — see `summarizeIssues` in `src/validate.ts`. Async
validators are rejected up front (`validate` must return `{value, issues}`,
not a Promise).

## Typing rows

```ts
interface TodoRow { id: number; title: string; done: number }
const sel = db.prepare<TodoRow>("SELECT ...", Todo);  // Stmt<TodoRow>
```

`Stmt<TRow>` carries the row type so `get`/`all` infer correctly. The
schema's `InferOutput` isn't enforced at compile time against `TRow` — keep
them aligned (the runtime validation is what enforces agreement).

## Lenient writes

Bind records may be `Partial`-shaped: omit a key and the parameter binds
NULL (SQLite's rule for unbound params — the column DEFAULT applies only
when the column is absent from the SQL text itself). `undefined` values also
bind NULL. For tuple params, the count must match `sqlite3_bind_parameter_count`
exactly — over-binding is a `BIND_PARAM` error.
