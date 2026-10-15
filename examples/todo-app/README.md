# todo-app

A chttp + `@cutils/sqlite` JSON API — the worked example of everything the
package offers: schema-validated inserts and reads through one shared
`@chttp/val` schema, named + positional binds, `getOrNull` for not-found, and
plain `SqliteError` propagation mapped to HTTP statuses.

## Routes

| Method | Path         | Body                               | Returns            |
| ------ | ------------ | ---------------------------------- | ------------------ |
| GET    | `/todos`     | —                                  | `Todo[]`           |
| POST   | `/todos`     | `{ title: string, done?: number }` | `201 Todo` / `400` |
| GET    | `/todos/:id` | —                                  | `Todo` / `404`     |
| DELETE | `/todos/:id` | —                                  | `204` / `404`      |

## Run it (Node)

```sh
pnpm install
pnpm --filter @cutils/sqlite build
pnpm --filter @cutils/sqlite build:shared   # build/libcutils_sqlite.so
pnpm --filter @cutils-example/todo-app start
```

Under Node the package's `shim_*` calls resolve on `globalThis` — install
them from the shared build the way
`packages/sqlite/test/koffi-binding.mjs` does (import it first, or copy the
~40 lines).

```sh
curl -X POST localhost:3000/todos -d '{"title":"ship it"}'
curl localhost:3000/todos/1
```

## Compile it (ELF)

```sh
scriptc build src/main.ts \
  --ffi ../../node_modules/@cutils/sqlite/vendor/manifest.json \
  -o todo-app
./todo-app
```

The vendored amalgamation + shim link statically — the ELF needs no sqlite
at runtime.

## DDL ↔ schema parity

`CREATE TABLE todos` and the `Todo`/`NewTodo` schemas describe the same
shape deliberately: every `SELECT` projection names the schema's fields, and
`done`'s `DEFAULT 0` covers a `NewTodo` that omits it (unbound params go in
as NULL — use column defaults or explicit values for NOT NULL columns).
