# The Standard-Schema seam

`db.prepare(sql, schema)` takes any Standard-Schema v1 validator — the
same seam as `@cutils/sqlite`. One schema validates **both directions**:
bind records on the way in (`run`), row records on the way out (`get` /
`getOrNull` / `all` / `getRaw` / `allRaw` analogues validate rows; `*Raw`
skips both).

The package checks conformance by calling
`schema["~standard"].validate(value)` — never by interface detection —
and resolves sync or Promise results, so any spec-complete library works.

## With `@chttp/val`

```ts
import * as v from "@chttp/val";

const Todo = v.object({
  id: v.number(),
  title: v.string(),
  done: v.boolean(),
});

const one = await db.prepare(
  "SELECT id, title, done FROM todos WHERE id = $1",
  Todo,
);
const row = await one.getOrNull([1]); // typed TRow | null
```

## With valibot

```ts
import * as v from "valibot";

const Todo = v.object({
  id: v.number(),
  title: v.string(),
  done: v.boolean(),
});
// identical call sites — the seam is the spec, not the library
const all = await db.prepare("SELECT * FROM todos", Todo);
```

## Writes

`run({...})` validates the bind record as `Partial<TRow>` — lenient
inserts: missing keys bind `NULL` for declared `$N` params. A failing
validate throws `PgError("VALIDATION")` before anything hits the wire.

Tuple binds (`stmt.run([v1, v2])`) are not schema-checked — validation is
record-shaped; use `prepareRaw` or pass records when you want it.

## Reads

Every row decodes to `Record<string, SqlValue>` then validates when a
schema is attached. `get`/`getOrNull` return `TRow`/`TRow | null`
(`undefined` for `get`); `all` returns `TRow[]`. A schema mismatch on
the wire (renamed column, wrong type) throws `PgError("VALIDATION")`.

## Escape hatch

The entire `*Raw` family — `prepareRaw`, `runRaw`, `getRaw`, `allRaw` —
skips validate in both directions. Reach for it with dynamic SQL, catalog
queries (`columns()` runs one itself), or values you cannot express in
the schema.
