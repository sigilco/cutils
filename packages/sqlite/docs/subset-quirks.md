# Subset quirks

`@cutils/sqlite` is authored in the scriptc compilable subset. Most rules are
the shared repo rules (see root `AGENTS.md`); this page collects the places
where the package's _surface_ bends — and what that means for your code.

## The `get()` / `getOrNull()` rule

`Stmt.get()` returns `TRow | undefined` for better-sqlite3 parity. That is the
**only** `| undefined` union permitted anywhere in cutils — spec-mandated,
fenced to this one method.

- In **scriptc apps** (anything compiled to an ELF), prefer `getOrNull()` —
  it returns `TRow | null`, composes with `if (row === null)`, and never
  grows an `undefined` union.
- `get()` exists for Node-side ergonomics and library parity; both share the
  same code path (one step, one optional validate, one row).

```ts
const hit = one.getOrNull([2]);
if (hit === null) {
  return; // subset-clean not-found
}
// hit is TRow here.
```

## Why `Stmt` looks odd in the source

Generic classes degrade to methodless shells under scriptc, so the generics
live on an interface:

```ts
export interface Stmt<TRow> extends StmtCore { /* typed overloads */ }
export const Stmt = StmtCore;
```

`db.prepare<TodoRow>(...)` returns `Stmt<TodoRow>`; the runtime object is
always `StmtCore`. Write your own interfaces the same way when a public
generic is needed — and never `extends` a narrower-typed field, which is
SC1090 (swap the instance in the constructor instead, the way `gate.ts`
swaps `this["~standard"]`).

## `using` in the subset

`using`/`Symbol.dispose` are wired through `Database`, `Stmt`, and
`Transaction` — but inside functions/blocks only. Top-level `using` is
SC1090, and `using` on an _interface-typed_ value (e.g. `Stmt<TRow>`) can't
lower the dispose call — use explicit `finalize()` there, or re-type the
binding as `StmtCore`.

## Span-ABI FFI

`vendor/manifest.json` is `ffi_format: 7`. `string`/`bytes` params marshal as
`(ptr, len)` spans — the shim never sees a NUL terminator, so it `dup_cstr`s
the few places SQLite requires one (filenames, `sqlite3_exec` SQL, savepoint
names) and passes explicit lengths everywhere else (`sqlite3_prepare_v2`,
`sqlite3_bind_text/blob` with `SQLITE_TRANSIENT`). Out params are
`mutable-bytes` `(buf, len)` pairs returning `>= 0` required bytes — the
wrapper's `Scratch` doubles until the payload fits — or `-1` for SQL NULL.

`gate.ffi.json` shadows the vendor manifest with `libraries` pointed at the
built archive; **regenerate it whenever the manifest changes** (the gate and
the `--ffi` build must agree or coverage reports SC5003 arity mismatches).

## Node shared library

`build/libcutils_sqlite.so` is built `-Wl,-Bsymbolic`. Node ≥ 22 exports its
own `sqlite3_*` symbols from the executable; without `-Bsymbolic` the shim's
internal `sqlite3_*` calls interpose onto Node's build, producing handles
Node's sqlite considers foreign — every call returns `SQLITE_MISUSE`. This is
verified by `test/wrapper.test.js` running under plain Node.

## What the subset forbids here (and how it's handled)

- `Map`/`Set` for open-statement tracking → `Database._stmts` is a plain
  array with linear remove-on-finalize.
- `?.`/`??`/spread/object shorthand → explicit `if (x === null)` checks and
  `Object.assign`-free literal shapes.
- `instanceof` on non-program types → schema conformance is checked by
  calling `schema["~standard"].validate`, never by interface detection.
- Union `A | B` of classes/records → `T | null` only; `SqliteError` extends
  `Error` rather than a result-object union.
