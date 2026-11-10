// scriptc coverage gate for @cutils/sqlite: exercises every public surface.
// Also the ELF smoke program — test/elf.test.sh builds this file with
// `scriptc build --ffi gate.ffi.json` and asserts the "gate OK" line.
//
// The inline schema uses the same shape @chttp/val uses: `~standard` is a
// class instance whose `validate` is a METHOD (function values inside
// records are subset-banned).

import { Database, SqliteError, StandardSchemaV1, StdProps } from "./src/index.ts";
import type { Row } from "./src/index.ts";

// In-subset schemas extend StandardSchemaV1/StdProps: cross-class widening
// is SC2003-banned, so structural siblings can't pass where the class is
// expected. (Plain-Node consumers' valibot/val schemas are unaffected —
// the class is only a structural shape outside the subset.)
class GateProps extends StdProps {
  constructor() {
    super();
    this.version = 1;
    this.vendor = "gate";
  }

  validate(input: unknown): unknown {
    if (typeof input !== "object" || input === null) {
      return { value: null, issues: [{ message: "value is not an object" }] };
    }
    const r = input as Row;
    if (typeof r.title !== "string") {
      return { value: null, issues: [{ message: "title must be a string" }] };
    }
    return { value: input, issues: null };
  }
}

class GateSchema extends StandardSchemaV1 {
  constructor() {
    super();
    // Can't redeclare `"~standard"` at a narrower type (SC1090); swap the
    // props INSTANCE instead — the declared type stays StdProps.
    this["~standard"] = new GateProps();
  }
}

function check(cond: boolean, name: string): void {
  if (!cond) {
    throw new Error("gate FAIL: " + name);
  }
}

function main(): void {
  using db = Database.openInMemory();
  check(db.memory, "memory flag");
  check(db.path === ":memory:", "path getter");
  check(!db.readonly, "readonly flag");
  check(!db.inTransaction, "inTransaction before tx");

  db.exec(
    "CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0, payload BLOB)",
  );
  db.execRaw("CREATE INDEX idx_todos_done ON todos(done)");

  const ins = db.prepare(
    "INSERT INTO todos (title, done, payload) VALUES (:title, :done, :payload)",
    new GateSchema(),
  );
  check(!ins.readonly, "insert is not readonly");
  check(!ins.reader, "insert is not a reader");
  check(ins.database === db, "stmt.database");
  check(ins.schema !== null, "stmt.schema");
  check(ins.source.length > 0, "stmt.source");

  const blob = new Uint8Array(4);
  blob[0] = 1;
  blob[1] = 2;
  blob[2] = 3;
  blob[3] = 255;
  const r1 = ins.run({ title: "write docs", done: 0, payload: blob });
  check(r1.changes === 1, "run changes");
  check(r1.lastInsertRowid === 1, "run lastInsertRowid");
  ins.runRaw({ title: "raw insert", done: 1 });
  check(db.lastInsertRowid() === 2, "db.lastInsertRowid");
  check(db.changes() === 1, "db.changes");

  // Validation seam: bad record is rejected with a VALIDATION SqliteError
  // before any bind happens.
  let vcode = "";
  try {
    ins.run({ title: 5, done: 0 });
  } catch (e) {
    if (e instanceof SqliteError) {
      vcode = e.code;
    }
  }
  check(vcode === "VALIDATION", "schema VALIDATION error code");

  const sel = db.prepareRaw("SELECT id, title, done FROM todos ORDER BY id");
  check(sel.reader, "select is a reader");
  check(sel.readonly, "select is readonly");
  check(sel.schema === null, "prepareRaw has null schema");

  const all = sel.all([]);
  check(all.length === 2, "all() row count");
  const raws = sel.allRaw([]);
  check(raws.length === 2, "allRaw() row count");

  const one = db.prepareRaw("SELECT id, title, done, payload FROM todos WHERE id = ?");
  const got = one.get([1]) as Row;
  check(got.title === "write docs", "get() row");
  const miss = one.get([999]);
  check(typeof miss === "undefined", "get() miss is undefined");
  const missN = one.getOrNull([999]);
  check(missN === null, "getOrNull() miss is null");
  const hitN = one.getOrNull([2]);
  check(hitN !== null, "getOrNull() hit");
  const hitRow = hitN as Row;
  check(hitRow.title === "raw insert", "getOrNull() row");
  const rawGet = one.getRaw([1]) as Row;
  check(rawGet.done === 0, "getRaw() row");

  // Blob round-trip through column_blob (row 1 carries the payload).
  const gotBlob = got.payload;
  check(gotBlob !== null && typeof gotBlob === "object", "blob not null");
  if (gotBlob !== null && typeof gotBlob === "object") {
    check(gotBlob.length === 4, "blob length");
    check(gotBlob[3] === 255, "blob byte");
  }

  // bind() permanent bind: empty params reuse the binding.
  one.bind([2]);
  const bound = one.getOrNull([]) as Row;
  check(bound.id === 2, "bind() permanent bind");
  check(one.toString().length > 0, "toString expanded sql");

  const cols = sel.columns();
  check(cols.length === 3, "columns() count");
  check(cols[0].name === "id", "columns() name");
  check(cols[0].table === "todos", "columns() table meta");
  check(cols[1].type === "TEXT", "columns() decl type");

  const pv = db.pragma("user_version");
  check(pv.rows.length === 1, "pragma() rows");

  // pragmaNamed read form: row objects keyed by pragma name.
  const pn = db.pragmaNamed("user_version");
  check(pn.length === 1, "pragmaNamed() read");
  check(pn[0].user_version === 0, "pragmaNamed() user_version default");

  // pragmaNamed write form: numeric, string, boolean values.
  db.pragmaNamed("user_version", 42);
  check(db.pragmaNamed("user_version")[0].user_version === 42, "pragmaNamed() numeric write");
  db.pragmaNamed("journal_mode", "MEMORY");
  check(
    String(db.pragmaNamed("journal_mode")[0].journal_mode).toUpperCase() === "MEMORY",
    "pragmaNamed() string write",
  );
  db.pragmaNamed("user_version", true);
  check(db.pragmaNamed("user_version")[0].user_version === 1, "pragmaNamed() boolean write");
  db.pragmaNamed("user_version", 0);
  check(db.pragmaNamed("user_version")[0].user_version === 0, "pragmaNamed() reset write");
  check(db.pragmaNamed("user_version", 7).changes >= 0, "pragmaNamed() write returns RunResult");

  // Injection rejection: identifier position is validated, never interpolated.
  let pcode = "";
  try {
    db.pragmaNamed("user_version; DROP TABLE todos");
  } catch (e) {
    if (e instanceof SqliteError) {
      pcode = e.code;
    }
  }
  check(pcode === "SQLITE_MISUSE", "pragmaNamed() rejects injection name");
  let pcode2 = "";
  try {
    db.pragmaNamed("");
  } catch (e) {
    if (e instanceof SqliteError) {
      pcode2 = e.code;
    }
  }
  check(pcode2 === "SQLITE_MISUSE", "pragmaNamed() rejects empty name");
  // A pragma name with a quote must be rejected, not double-quoted through.
  let pcode3 = "";
  try {
    db.pragmaNamed('us"er_version');
  } catch (e) {
    if (e instanceof SqliteError) {
      pcode3 = e.code;
    }
  }
  check(pcode3 === "SQLITE_MISUSE", "pragmaNamed() rejects quote in name");

  // iterate: one row per step through a generator, plus manual next().
  const itSel = db.prepareRaw("SELECT title FROM todos WHERE done = 0 ORDER BY id");
  let itCount = 0;
  let firstTitle = "";
  for (const row of itSel.iterate([])) {
    itCount += 1;
    if (itCount === 1) {
      firstTitle = String((row as Row).title);
    }
  }
  check(itCount === 1, "iterate() row count");
  check(firstTitle === "write docs", "iterate() first row");

  const manual = itSel.iterate([]);
  const m1 = manual.next();
  check(m1.done === false, "iterate() not done on first");
  check((m1.value as Row).title === "write docs", "iterate() manual first");
  check(manual.next().done === true, "iterate() done at exhaustion");

  // Named-parameter bind form.
  const named = db.prepareRaw("SELECT title FROM todos WHERE done = :d ORDER BY id");
  let done1 = 0;
  for (const row of named.iterate({ d: 1 })) {
    if ((row as Row).title === "raw insert") {
      done1 += 1;
    }
  }
  check(done1 === 1, "iterate() named params");
  named.finalize();
  itSel.finalize();

  // iterate on a finalized statement throws eagerly (MISUSE), not lazily.
  const dead = db.prepareRaw("SELECT 1 AS one");
  dead.finalize();
  let icode = "";
  try {
    dead.iterate([]);
  } catch (e) {
    if (e instanceof SqliteError) {
      icode = e.code;
    }
  }
  check(icode === "SQLITE_MISUSE", "iterate() on finalized stmt");

  // Transactions: commit, auto-savepoint on nesting, explicit savepoint,
  // rollback, and error-driven rollback via dispose.
  {
    using tx = db.transaction();
    check(db.inTransaction, "inTransaction inside tx");
    check(tx.database === db, "tx.database");
    tx.execRaw("INSERT INTO todos (title, done) VALUES ('tx row', 0)");
    const txIns = tx.prepare(
      "INSERT INTO todos (title, done) VALUES (:title, :done)",
      new GateSchema(),
    );
    txIns.run({ title: "tx schema row", done: 0 });
    txIns.finalize();
    {
      using nested = db.transaction();
      ins.runRaw({ title: "nested row", done: 0 });
      nested.rollback();
    }
    using sp = tx.savepoint("gate_sp");
    ins.runRaw({ title: "savepoint row", done: 0 });
    sp.commit();
    tx.commit();
  }
  check(!db.inTransaction, "tx committed");
  const cnt = db.prepareRaw("SELECT COUNT(*) AS n FROM todos");
  const cntRow = cnt.getOrNull([]) as Row;
  check(cntRow.n === 5, "rows after tx commit");

  // Empty-string bind must round-trip as '' — an empty span can reach the
  // shim as a NULL pointer and sqlite3_bind_text(NULL, n) binds SQL NULL.
  const emp = db.prepareRaw("INSERT INTO todos (title, done) VALUES (?, ?)");
  emp.runRaw(["", 0]);
  const empHit = db
    .prepareRaw("SELECT id FROM todos WHERE title = '' AND id = ?")
    .getOrNull([db.lastInsertRowid()]);
  check(empHit !== null, "empty-string bind stays ''");
  emp.finalize();

  let txErrCode = "";
  try {
    using tx2 = db.transaction();
    db.exec("INSERT INTO todos (title) VALUES (NULL)");
    tx2.commit();
  } catch (e) {
    if (e instanceof SqliteError) {
      txErrCode = e.code;
    }
  }
  check(txErrCode === "SQLITE_CONSTRAINT_NOTNULL", "tx constraint error code");
  check(!db.inTransaction, "tx rolled back on error");

  // Statement finalize + Database.close idempotency. (`using` on a Stmt is
  // impossible in-subset: the value's static type is the Stmt<TRow>
  // interface, which has no concrete lowering for dispose.)
  const tmp = db.prepareRaw("SELECT 1 AS one");
  const tmpRow = tmp.getOrNull([]) as Row;
  check(tmpRow.one === 1, "prepared scalar");
  tmp.finalize();
  sel.finalize();
  sel.finalize();

  db.close();
  db.close();
  console.log("gate OK");
}

main();
