// todo-app — a chttp + @cutils/sqlite JSON API in ~80 lines.
//
//   GET    /todos            list all todos
//   POST   /todos            { title, done? }  → created todo (validated)
//   GET    /todos/:id        one todo or 404
//   DELETE /todos/:id        204 or 404
//
// Rows and write bodies share the same @chttp/val schema through
// db.prepare(sql, schema): write params are validated before binding, row
// records on the way out — SqliteError("VALIDATION") maps to 400/500.
//
// Run under Node:  pnpm --filter @cutils-example/todo-app start
//   (installs the shim globals from the package's shared-library build —
//   see packages/sqlite/test/koffi-binding.mjs)
// Compile to a single ELF:
//   scriptc build src/main.ts --ffi node_modules/@cutils/sqlite/vendor/manifest.json

import { app } from "@chttp/router";
import * as v from "@chttp/val";
import { Database, SqliteError } from "@cutils/sqlite";

const Todo = v.strictObject({
  id: v.number(),
  title: v.string(),
  done: v.number(),
});
const NewTodo = v.strictObject({
  title: v.pipe(v.string(), v.minLength(1)),
  done: v.optional(v.number()),
});

const db = Database.open("todo.db");
db.exec(
  "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0)",
);

const ins = db.prepare("INSERT INTO todos (title, done) VALUES (:title, :done)", NewTodo);
const list = db.prepare("SELECT id, title, done FROM todos ORDER BY id", Todo);
const one = db.prepare("SELECT id, title, done FROM todos WHERE id = ?", Todo);
const del = db.prepareRaw("DELETE FROM todos WHERE id = ?");

const server = app();

server.get("/todos", (c) => {
  return c.json(list.all([]));
});

server.post("/todos", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  try {
    const r = ins.run(body);
    const created = one.getOrNull([r.lastInsertRowid]);
    return c.json(created, 201);
  } catch (e) {
    if (e instanceof SqliteError && e.code === "VALIDATION") {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

server.get("/todos/:id", (c) => {
  const row = one.getOrNull([Number(c.req.param("id"))]);
  if (row === null) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(row);
});

server.delete("/todos/:id", (c) => {
  const r = del.run([Number(c.req.param("id"))]);
  if (r.changes === 0) {
    return c.json({ error: "not found" }, 404);
  }
  return c.body(null, 204);
});

server.listen(3000);
console.log("todo-app on http://localhost:3000");
