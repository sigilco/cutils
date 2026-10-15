// scriptc coverage gate + ELF smoke for @cutils/postgres: exercises every
// public surface against a canned wire server (test/mock-server.mjs) so the
// compiled binary proves node:net + node:crypto + the whole protocol stack
// lower and run. `scriptc coverage gate.ts` must report 100%; test/elf.test.sh
// builds this file and asserts the "gate OK" line.
//
// The inline schema uses the same shape @chttp/val uses: `~standard` is a
// class instance whose `validate` is a METHOD.

import { Database, PgError, StandardSchemaV1, StdProps } from "./src/index.ts";
import type { Row } from "./src/index.ts";

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
    if (typeof r.title !== "string" && typeof r.id !== "number") {
      return { value: null, issues: [{ message: "row needs title or id" }] };
    }
    return { value: input, issues: null };
  }
}

class GateSchema extends StandardSchemaV1 {
  constructor() {
    super();
    this["~standard"] = new GateProps();
  }
}

function check(cond: boolean, name: string): void {
  if (!cond) {
    throw new Error("gate FAIL: " + name);
  }
}

async function main(): Promise<void> {
  let port = 5432;
  const arg = process.argv[2];
  if (typeof arg === "string" && arg.length > 0) {
    port = Number.parseInt(arg, 10);
  }
  const db = await Database.connect({
    host: "127.0.0.1",
    port: port,
    user: "gate",
    password: "gate",
    database: "gatedb",
    applicationName: "cutils-gate",
    connectTimeoutMs: 5000,
  });
  check(db.host === "127.0.0.1", "host getter");
  check(db.port === port, "port getter");
  check(db.database === "gatedb", "database getter");
  check(db.user === "gate", "user getter");
  check(db.backendPid === 4242, "backendPid");
  check(db.backendSecret === 777, "backendSecret");
  check(db.serverVersion === "16.3", "serverVersion");
  check(!db.inTransaction, "inTransaction before tx");
  await db.exec("CREATE TABLE todos (id int, title text)");
  await db.execRaw("CREATE INDEX idx ON todos(id)");
  const execRes = await db.execute("SET x = 1");
  check(typeof execRes.rowCount === "number", "execute rowCount");
  const shown = await db.pragma("SHOW x");
  check(shown.rows.length === 1, "pragma rows");
  const ins = await db.prepare(
    "INSERT INTO todos (title, done) VALUES (:title, :done)",
    new GateSchema(),
  );
  check(!ins.readonly, "insert not readonly");
  check(!ins.reader, "insert not reader");
  check(ins.database === db, "stmt.database");
  check(ins.schema !== null, "stmt.schema");
  check(ins.source.length > 0, "stmt.source");
  check(ins.source.indexOf(":title") >= 0, "stmt.source is original sql");
  const str = ins.toString();
  check(str.length > 0, "stmt.toString non-empty");
  const r1 = await ins.run({ title: "write docs", done: false });
  check(r1.rowCount === 1, "run rowCount");
  await ins.runRaw({ title: "raw", done: true });
  ins.bind({ title: "bound", done: false });
  await ins.runRaw([]); // raw path: uses bound params without re-validating
  const sel = await db.prepare("SELECT id, title, done FROM todos", new GateSchema());
  check(sel.readonly, "select readonly");
  check(sel.reader, "select reader");
  const cols = sel.columns();
  check(cols.length === 3, "columns count");
  check(cols[0].name === "id", "columns name");
  const g = await sel.get([]);
  check(g !== undefined, "get row");
  const gn = await sel.getOrNull([]);
  check(gn !== null, "getOrNull row");
  const gr = await sel.getRaw([]);
  check(gr !== null, "getRaw row");
  const all = await sel.all([]);
  check(all.length === 2, "all rows");
  const ar = await sel.allRaw([]);
  check(ar.length === 2, "allRaw rows");
  const selRaw = await db.prepareRaw("SELECT id, title, done FROM todos");
  check(selRaw.schema === null, "prepareRaw schema null");

  // Named + positional binds through the unnamed execute path too.
  const named = await db.prepare(
    "SELECT id FROM todos WHERE id = :id AND done = @done",
    new GateSchema(),
  );
  const namedRows = await named.all({ id: 1, done: false });
  check(namedRows.length === 2, "named bind rows");
  await using tx = await db.transaction();
  check(db.inTransaction, "inTransaction inside tx");
  await tx.exec("INSERT INTO todos (title) VALUES ('x')");
  const txStmt = await tx.prepare("SELECT id FROM todos", new GateSchema());
  const txRows = await txStmt.all([]);
  check(txRows.length === 2, "tx stmt rows");
  const inner = await tx.savepoint("g1");
  await inner.exec("INSERT INTO todos (title) VALUES ('y')");
  await inner.rollback();
  await tx.commit();
  const notifyRes = await db.notify("chan", "hello");
  check(notifyRes.received.length === 1, "notify drained");
  check(notifyRes.received[0].payload === "hello", "notify payload");

  let errCode = "";
  try {
    await db.exec("select_fail this");
  } catch (e) {
    errCode = (e as PgError).code;
  }
  check(errCode === "42601", "PgError code");

  let threwRowid = false;
  try {
    await db.lastInsertRowid();
  } catch (e) {
    threwRowid = (e as PgError).code === "0A000";
  }
  check(threwRowid, "lastInsertRowid throws");
  let threwChanges = false;
  try {
    await db.changes();
  } catch (e) {
    threwChanges = (e as PgError).code === "0A000";
  }
  check(threwChanges, "changes throws");
  await sel.finalize();
  await ins.finalize();
  await db.close();
  await using db2 = await Database.connect({
    host: "127.0.0.1",
    port: port,
    user: "gate",
    password: "gate",
    database: "gatedb",
  });
  check(db2.backendPid === 4242, "second connect");

  console.log("gate OK");
}
await main();
