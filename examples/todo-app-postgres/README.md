# todo-app-postgres

A chttp + `@cutils/postgres` JSON API — the worked example of the async
variant of the cutils database skeleton: `await Database.connect`,
schema-validated writes and reads through one shared `@chttp/val` schema,
named + positional binds, `getOrNull` for not-found, `RETURNING` for
insert-and-read-back, and `PgError` mapped to HTTP statuses.

## Routes

| Method | Path         | Body                                | Returns            |
| ------ | ------------ | ----------------------------------- | ------------------ |
| GET    | `/todos`     | —                                   | `Todo[]`           |
| POST   | `/todos`     | `{ title: string, done?: boolean }` | `201 Todo` / `400` |
| GET    | `/todos/:id` | —                                   | `Todo` / `404`     |
| DELETE | `/todos/:id` | —                                   | `204` / `404`      |

## Run it (Node)

```sh
docker run -d --name pg -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16-alpine
pnpm install
pnpm --filter @cutils/postgres build
PG_DSN=postgres://postgres:pg@127.0.0.1:5432/postgres \
  pnpm --filter @cutils-example/todo-app-postgres start
```

## Compile it (ELF)

`scriptc build src/main.ts` — the whole driver lowers with the app; no
`pg`/`libpq` anywhere. Plain TCP only (v1 has no TLS).
