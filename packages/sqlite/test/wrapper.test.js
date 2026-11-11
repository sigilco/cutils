// Node-side suite for the emitted wrapper (dist/esm) over the shared shim
// lib via test/koffi-binding.mjs. Same fixtures run through BOTH @chttp/val
// and valibot schemas to prove the Standard-Schema seam.

import "./koffi-binding.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { Database, SqliteError } from "../dist/esm/index.js";
import * as v from "valibot";
import * as val from "@chttp/val";

const todoValibot = v.object({
  id: v.optional(v.number()),
  title: v.string(),
  done: v.optional(v.number()),
});

const todoVal = val.object({
  id: val.optional(val.number()),
  title: val.string(),
  done: val.optional(val.number()),
});

function fresh() {
  const db = Database.openInMemory();
  db.exec(
    "CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0, payload BLOB)",
  );
  return db;
}

test("anonymous + named params, get/getOrNull parity", () => {
  const db = fresh();
  const ins = db.prepareRaw("INSERT INTO todos (title, done, payload) VALUES (?, ?, ?)");
  const r = ins.run(["anon row", 1, null]);
  assert.equal(r.changes, 1);
  assert.equal(r.lastInsertRowid, 1);

  const named = db.prepareRaw("INSERT INTO todos (title, done) VALUES (:title, :done)");
  named.run({ title: "named row", done: 0 });
  named.run({ ":title": "colon row", "@done": 1 });

  const sel = db.prepareRaw("SELECT id, title, done FROM todos WHERE id = ?");
  const g = sel.get([1]);
  assert.equal(g.title, "anon row");
  const gn = sel.getOrNull([2]);
  assert.equal(gn.title, "named row");
  assert.equal(sel.getOrNull([42]), null);
  assert.equal(sel.get([42]), undefined);

  const all = sel.database.prepareRaw("SELECT title FROM todos ORDER BY id").all([]);
  assert.deepEqual(
    all.map((x) => x.title),
    ["anon row", "named row", "colon row"],
  );
  db.close();
});

test("schema seam: same fixtures through valibot AND @chttp/val", () => {
  for (const [name, schema] of [
    ["valibot", todoValibot],
    ["val", todoVal],
  ]) {
    const db = fresh();
    const ins = db.prepare("INSERT INTO todos (title, done) VALUES (:title, :done)", schema);
    // Lenient insert: Partial-shaped record, `id` omitted.
    ins.run({ title: name + " row", done: 0 });
    // Truly-partial record too: unbound params go in as NULL (readable via *Raw).
    ins.run({ title: name + " partial" });

    const sel = db.prepare("SELECT id, title, done FROM todos", schema);
    const row = sel.getOrNull([]);
    assert.equal(row.title, name + " row");
    assert.equal(row.id, 1);

    // Validation failure on write → SqliteError VALIDATION.
    assert.throws(
      () => ins.run({ title: 123 }),
      (e) => e instanceof SqliteError && e.code === "VALIDATION",
    );
    // Validation failure on read: a CAST produces an INTEGER into `title`
    // (column affinity would coerce a stored 123 back to TEXT).
    const badSel = db.prepare(
      "SELECT id, CAST(title AS INTEGER) AS title, done FROM todos LIMIT 1",
      schema,
    );
    assert.throws(
      () => badSel.get([]),
      (e) => e instanceof SqliteError && e.code === "VALIDATION",
    );

    // *Raw opt-outs bypass validation entirely.
    const raw = db.prepareRaw("SELECT id, title FROM todos ORDER BY id");
    assert.equal(raw.getRaw([]).title, name + " row");
    assert.equal(raw.allRaw([]).length, 2);
    const partialRow = db.prepareRaw("SELECT done FROM todos WHERE id = 2").getOrNull([]);
    assert.equal(partialRow.done, null);
    db.close();
  }
});

test("run validates and binds the transformed output", () => {
  const coercing = v.object({
    title: v.string(),
    done: v.pipe(
      v.number(),
      v.transform((n) => n * 10),
    ),
  });
  const db = fresh();
  const ins = db.prepare("INSERT INTO todos (title, done) VALUES (:title, :done)", coercing);
  ins.run({ title: "xform", done: 2 });
  const row = db.prepareRaw("SELECT done FROM todos").getOrNull([]);
  assert.equal(row.done, 20);
  db.close();
});

test("transactions: commit, nested auto-savepoint, rollback", () => {
  const db = fresh();
  const tx = db.transaction();
  try {
    db.exec("INSERT INTO todos (title) VALUES ('a')");
    const nested = db.transaction();
    try {
      db.exec("INSERT INTO todos (title) VALUES ('b')");
      nested.rollback();
    } finally {
      nested[Symbol.dispose]();
    }
    const sp = tx.savepoint("sp1");
    try {
      db.exec("INSERT INTO todos (title) VALUES ('c')");
      sp.rollback();
    } finally {
      sp[Symbol.dispose]();
    }
    tx.commit();
  } finally {
    tx[Symbol.dispose]();
  }
  const n = db.prepareRaw("SELECT COUNT(*) AS n FROM todos").getOrNull([]);
  assert.equal(n.n, 1);
  assert.equal(db.inTransaction, false);

  // Error inside a tx marks it failed; dispose rolls back.
  assert.throws(() => {
    const tx2 = db.transaction();
    try {
      db.exec("INSERT INTO todos (title) VALUES (NULL)");
      tx2.commit();
    } finally {
      tx2[Symbol.dispose]();
    }
  }, SqliteError);
  assert.equal(db.inTransaction, false);
  db.close();
});

test("blob round-trip + bigint handling", () => {
  const db = fresh();
  const blob = new Uint8Array([0, 1, 2, 250, 255]);
  db.prepareRaw("INSERT INTO todos (title, payload) VALUES (?, ?)").run(["blobby", blob]);
  db.prepareRaw("INSERT INTO todos (title, done) VALUES (?, ?)").run([
    "big",
    BigInt("9007199254740993"),
  ]);
  const r1 = db.prepareRaw("SELECT payload FROM todos WHERE id = 1").getOrNull([]);
  assert.deepEqual([...r1.payload], [0, 1, 2, 250, 255]);
  const r2 = db.prepareRaw("SELECT done FROM todos WHERE id = 2").getOrNull([]);
  assert.equal(r2.done, BigInt("9007199254740993"));
  db.close();
});

test("empty string and empty blob bind as empty, not NULL", () => {
  const db = fresh();
  db.prepareRaw("INSERT INTO todos (title, payload) VALUES (?, ?)").run(["", new Uint8Array(0)]);
  const r = db
    .prepareRaw(
      "SELECT title, payload, title IS NULL AS tnull, payload IS NULL AS pnull FROM todos WHERE id = 1",
    )
    .getOrNull([]);
  assert.equal(r.title, "");
  assert.equal(r.tnull, 0);
  assert.equal(r.payload.length, 0);
  assert.equal(r.pnull, 0);
  db.close();
});

test("pragma, columns, expanded sql, bind", () => {
  const db = fresh();
  const pv = db.pragma("user_version");
  assert.equal(pv.rows.length, 1);

  const sel = db.prepareRaw("SELECT id, title FROM todos WHERE id = ?");
  const cols = sel.columns();
  assert.equal(cols.length, 2);
  assert.equal(cols[0].name, "id");
  assert.equal(cols[0].table, "todos");
  assert.equal(cols[1].type, "TEXT");

  sel.bind([7]);
  assert.match(sel.toString(), /7/);
  assert.equal(sel.getOrNull([]), null);
  db.close();
});

test("pragmaNamed: read and write forms", () => {
  const db = fresh();
  const before = db.pragmaNamed("user_version");
  assert.equal(before.length, 1);
  assert.equal(before[0].user_version, 0);

  const wr = db.pragmaNamed("user_version", 42);
  assert.equal(wr.changes, 0);
  const after = db.pragmaNamed("user_version");
  assert.equal(after[0].user_version, 42);

  db.pragmaNamed("journal_mode", "MEMORY");
  const jm = db.pragmaNamed("journal_mode");
  assert.equal(String(jm[0].journal_mode).toUpperCase(), "MEMORY");

  // double-quoted identifier: mixed case + digits + underscore survive
  db.exec("CREATE TABLE t2 (a)");
  db.pragmaNamed("temp_store", 1);
  assert.equal(db.pragmaNamed("temp_store")[0].temp_store, 1);

  // injection attempt must be rejected, not interpolated
  assert.throws(
    () => db.pragmaNamed("user_version; DROP TABLE todos"),
    (e) => e.code === "SQLITE_MISUSE",
  );
  assert.throws(
    () => db.pragmaNamed(""),
    (e) => e.code === "SQLITE_MISUSE",
  );
  db.close();
});

test("iterate: rows one at a time, lazily", () => {
  const db = fresh();
  const ins = db.prepareRaw("INSERT INTO todos (title, done) VALUES (?, ?)");
  ins.run(["i1", 0]);
  ins.run(["i2", 1]);
  ins.run(["i3", 0]);
  ins.finalize();

  const sel = db.prepareRaw("SELECT title FROM todos WHERE done = 0 ORDER BY id");
  const it = sel.iterate([]);
  const seen = [];
  for (const row of it) {
    seen.push(row.title);
  }
  assert.deepEqual(seen, ["i1", "i3"]);

  // manual next() driving + done detection
  const it2 = sel.iterate([]);
  assert.deepEqual(it2.next().value, { title: "i1" });
  assert.equal(it2.next().done, false);
  assert.equal(it2.next().done, true);
  sel.finalize();

  // named-parameter bind form + empty reuse
  const sel2 = db.prepareRaw("SELECT title FROM todos WHERE done = :d ORDER BY id");
  const one = Array.from(sel2.iterate({ d: 1 })).map((r) => r.title);
  assert.deepEqual(one, ["i2"]);
  sel2.finalize();

  // iterate on a finalized statement throws eagerly at the call
  const dead = db.prepareRaw("SELECT 1");
  dead.finalize();
  assert.throws(
    () => dead.iterate([]),
    (e) => e.code === "SQLITE_MISUSE",
  );
  db.close();
});

test("errors: SqliteError codes propagate", () => {
  const db = fresh();
  assert.throws(
    () => db.exec("INSERT INTO nosuch (a) VALUES (1)"),
    (e) => {
      assert.equal(e instanceof SqliteError, true);
      assert.equal(e.code, "SQLITE_ERROR");
      return true;
    },
  );
  assert.throws(
    () => db.exec("INSERT INTO todos (title) VALUES (NULL)"),
    (e) => e.code === "SQLITE_CONSTRAINT_NOTNULL",
  );
  assert.throws(
    () => db.prepareRaw("INSERT INTO todos (title) VALUES (?)").run([1, 2]),
    (e) => e.code === "BIND_PARAM",
  );
  db.close();
  assert.throws(
    () => db.exec("SELECT 1"),
    (e) => e.code === "SQLITE_MISUSE",
  );
});

test("Symbol.dispose + readonly open", () => {
  const mem = Database.openInMemory();
  try {
    assert.equal(mem.memory, true);
    assert.equal(mem.readonly, false);
  } finally {
    mem[Symbol.dispose]();
  }
  const tmp = `${import.meta.dirname}/tmp-ro.db`;
  const w = Database.open(tmp);
  try {
    w.exec("CREATE TABLE t (a INTEGER)");
  } finally {
    w[Symbol.dispose]();
  }
  const ro = Database.open(tmp, { readonly: true });
  try {
    assert.equal(ro.readonly, true);
    assert.equal(ro.memory, false);
    assert.throws(
      () => ro.exec("INSERT INTO t VALUES (1)"),
      (e) => e.code === "SQLITE_READONLY",
    );
  } finally {
    ro[Symbol.dispose]();
  }
  unlinkSync(tmp);
});

test("FTS5 is compiled in", () => {
  const db = Database.openInMemory();
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, body)");
  db.exec("INSERT INTO docs (title, body) VALUES ('hello', 'native sqlite with full text search')");
  const rows = db.prepareRaw("SELECT title FROM docs WHERE docs MATCH ?").all(["search"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "hello");
});
