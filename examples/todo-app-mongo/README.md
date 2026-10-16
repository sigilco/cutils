# todo-app-mongo

A chttp + `@cutils/mongo` JSON API — the worked example: one
`@chttp/val` schema bound through `client.withSchema(schema)` so every
document out of the database is validated, `ObjectId` hex ids in the
URL, and `MongoError` propagation mapped to HTTP statuses.

## Routes

| Method | Path         | Body                                | Returns            |
| ------ | ------------ | ----------------------------------- | ------------------ |
| GET    | `/todos`     | —                                   | `Todo[]`           |
| POST   | `/todos`     | `{ title: string, done?: boolean }` | `201 Todo` / `400` |
| GET    | `/todos/:id` | —                                   | `Todo` / `404`     |
| DELETE | `/todos/:id` | —                                   | `204` / `404`      |

## Run it (Node)

```sh
docker run -d -p 27017:27017 mongo:7
pnpm install
MONGO_URI=mongodb://localhost:27017 pnpm --filter @cutils-example/todo-app-mongo start
```

## Compile it (scriptc)

```sh
scriptc build src/main.ts
```

No FFI manifest needed — the driver is pure `node:net`/`node:tls`/
`node:crypto`; the ELF talks to mongod over the wire directly.
