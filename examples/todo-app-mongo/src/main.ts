// todo-app-mongo — a chttp + @cutils/mongo JSON API.
//
//   GET    /todos            list all todos
//   POST   /todos            { title, done? }  → created todo (validated)
//   GET    /todos/:id        one todo or 404
//   DELETE /todos/:id        204 or 404
//
// Reads and writes share the same @chttp/val schema through
// client.withSchema(schema): every document out of the database is
// validated — MongoError("Validation") maps to 400/500.
//
// Needs a mongod: docker run -d -p 27017:27017 mongo:7
// Run under Node:  MONGO_URI=mongodb://localhost:27017 pnpm --filter @cutils-example/todo-app-mongo start
// Compile to a single ELF (no FFI manifest — pure node:net):
//   scriptc build src/main.ts

import { app } from "@chttp/router";
import * as v from "@chttp/val";
import { MongoClient, MongoError, ObjectId } from "@cutils/mongo";

const Todo = v.strictObject({
  _id: v.string(), // ObjectId -> hex string in the schema view
  title: v.string(),
  done: v.boolean(),
});
const NewTodo = v.strictObject({
  title: v.pipe(v.string(), v.minLength(1)),
  done: v.optional(v.boolean()),
});

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
const client = await MongoClient.connect({
  uri: uri,
  dbName: "todoapp",
  appName: "todo-app-mongo",
});
const db = client.withSchema(Todo);
const todos = db.collection("todos");

const server = app();

server.get("/todos", async (c) => {
  const docs = await todos.find({}, { sort: { title: 1 } }).all();
  return c.json(docs);
});

server.post("/todos", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  try {
    const doc = NewTodo["~standard"].validate(body) as {
      value?: { title: string; done?: boolean };
    };
    if (typeof doc.value === "undefined") {
      return c.json({ error: "invalid body" }, 400);
    }
    const id = await todos.insertOne({ title: doc.value.title, done: doc.value.done === true });
    const created = await todos.findOne({ _id: id });
    return c.json(created, 201);
  } catch (e) {
    if (e instanceof MongoError && e.codeName === "Validation") {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }
});

server.get("/todos/:id", async (c) => {
  if (!ObjectId.isHex(c.req.param("id"))) {
    return c.json({ error: "not found" }, 404);
  }
  const doc = await todos.findOne({ _id: ObjectId.fromHex(c.req.param("id")) });
  if (doc === null) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(doc);
});

server.delete("/todos/:id", async (c) => {
  if (!ObjectId.isHex(c.req.param("id"))) {
    return c.json({ error: "not found" }, 404);
  }
  const n = await todos.deleteOne({ _id: ObjectId.fromHex(c.req.param("id")) });
  if (n === 0) {
    return c.json({ error: "not found" }, 404);
  }
  return c.body(null, 204);
});

server.listen(8080);
