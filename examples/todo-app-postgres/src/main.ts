// todo-app-postgres — a chttp + @cutils/postgres JSON API in ~90 lines.
//
//   GET    /todos            list all todos
//   POST   /todos            { title, done? }  → created todo (validated)
//   GET    /todos/:id        one todo or 404
//   DELETE /todos/:id        204 or 404
//
// Rows and write bodies share one @chttp/val schema through
// db.prepare(sql, schema): write params validate before binding, row
// records on the way out — PgError("VALIDATION") maps to 400/500.
//
// Needs a Postgres:  docker run -d -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16-alpine
// Run:  PG_DSN=postgres://postgres:pg@127.0.0.1:5432/postgres \
//         pnpm --filter @cutils-example/todo-app-postgres start
// Compile with the app:  scriptc build src/main.ts

import { app } from "@chttp/router";
import * as v from "@chttp/val";
import { Database, PgError } from "@cutils/postgres";

const Todo = v.object({
  id: v.number(),
  title: v.string(),
  done: v.boolean(),
});
const dsn = new URL(process.env.PG_DSN ?? "postgres://postgres:pg@127.0.0.1:5432/postgres");
const db = await Database.connect({
  host: dsn.hostname,
  port: Number(dsn.port || 5432),
  user: decodeURIComponent(dsn.username),
  password: decodeURIComponent(dsn.password),
  database: dsn.pathname.replace(/^\//, "") || "postgres",
  applicationName: "todo-app-postgres",
});
await db.exec(
  "CREATE TABLE IF NOT EXISTS todos (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT false)",
);

const ins = await db.prepare(
  "INSERT INTO todos (title, done) VALUES (:title, :done) RETURNING id, title, done",
  Todo,
);
const list = await db.prepare("SELECT id, title, done FROM todos ORDER BY id", Todo);
const one = await db.prepare("SELECT id, title, done FROM todos WHERE id = $1", Todo);
const del = await db.prepareRaw("DELETE FROM todos WHERE id = $1");

const server = app();

server.get("/todos", async (c) => {
  return c.json(await list.all([]));
});

server.post("/todos", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  try {
    // RETURNING hands the created row straight back through validation.
    const created = await ins.getOrNull(body as { title: string; done: boolean });
    return c.json(created, 201);
  } catch (e) {
    if (e instanceof PgError && e.code === "VALIDATION") {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

server.get("/todos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await one.getOrNull([id]);
  if (row === null) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(row);
});

server.delete("/todos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await del.run([id]);
  if (r.rowCount === 0) {
    return c.json({ error: "not found" }, 404);
  }
  return c.body(null, 204);
});

server.listen(3000);
console.log("todo-app-postgres on http://localhost:3000");
