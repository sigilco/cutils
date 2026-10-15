// Integration tests against a real Postgres — skipped unless PG_TEST_DSN
// or PG_TEST_PORT is set. Spin one up with:
//   docker run -d --name cutils-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16-alpine
//   PG_TEST_PORT=55432 PG_TEST_PASSWORD=pg node --test test/pg.test.js
// or a full DSN: PG_TEST_DSN=postgres://user:pass@host:port/db

import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../dist/esm/index.js";

const DSN = process.env.PG_TEST_DSN ?? "";
const PORT = process.env.PG_TEST_PORT ?? "";
const SKIP = DSN === "" && PORT === "";

function opts() {
  if (DSN !== "") {
    const u = new URL(DSN);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, "") || "postgres",
    };
  }
  return {
    host: process.env.PG_TEST_HOST ?? "127.0.0.1",
    port: Number(PORT),
    user: process.env.PG_TEST_USER ?? "postgres",
    password: process.env.PG_TEST_PASSWORD ?? "postgres",
    database: process.env.PG_TEST_DB ?? "postgres",
  };
}

test("pg: connect, round-trip types, tx, validation, cancel", { skip: SKIP }, async () => {
  const db = await Database.connect({ ...opts(), applicationName: "cutils-test" });
  try {
    const suffix = String(process.pid);
    await db.exec(`DROP TABLE IF EXISTS cutils_pg_t_${suffix}`);
    await db.exec(
      `CREATE TABLE cutils_pg_t_${suffix} (id serial PRIMARY KEY, title text NOT NULL, done boolean DEFAULT false, n int4, f float8, b bytea, ts timestamptz, u uuid, j jsonb)`,
    );

    const ins = await db.prepareRaw(
      `INSERT INTO cutils_pg_t_${suffix} (title, done, n, f, b, ts, u, j) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    );
    const r = await ins.run([
      "hello",
      true,
      42,
      3.25,
      new Uint8Array([0, 255, 16]),
      "2026-10-15T10:00:00.000Z",
      "123e4567-e89b-12d3-a456-426614174000",
      '{"a":1}',
    ]);
    assert.equal(r.rowCount, 1);

    const sel = await db.prepareRaw(
      `SELECT title, done, n, f, b, ts, u, j FROM cutils_pg_t_${suffix}`,
    );
    const row = await sel.getOrNull([]);
    assert.equal(row.title, "hello");
    assert.equal(row.done, true);
    assert.equal(row.n, 42);
    assert.equal(row.f, 3.25);
    assert.deepEqual([...row.b], [0, 255, 16]);
    // timestamps round-trip as ISO strings (Date is not in the compiled union)
    assert.equal(row.ts, "2026-10-15T10:00:00.000Z");
    assert.equal(row.u, "123e4567-e89b-12d3-a456-426614174000");
    // jsonb re-formats on output — compare parsed, not literal text
    assert.equal(JSON.parse(row.j).a, 1);

    const cols = sel.columns();
    assert.equal(cols[0].name, "title");
    assert.equal(cols[0].table, `cutils_pg_t_${suffix}`);
    assert.equal(cols[0].notNull, true);
    assert.equal(cols[1].default, "false");

    // named binds
    const named = await db.prepareRaw(`SELECT $1::int + $2::int AS s`);
    const named2 = await db.prepareRaw(`SELECT :x::int + :y::int AS s`);
    const srow = await named.getOrNull([2, 3]);
    assert.equal(srow.s, 5);
    const srow2 = await named2.getOrNull({ x: 2, y: 4 });
    assert.equal(srow2.s, 6);

    // transactions + savepoints
    const tx = await db.transaction();
    await tx.exec(`INSERT INTO cutils_pg_t_${suffix} (title) VALUES ('txrow')`);
    const inner = await tx.savepoint("sp1");
    await inner.exec(`INSERT INTO cutils_pg_t_${suffix} (title) VALUES ('rolled')`);
    await inner.rollback();
    await tx.commit();
    const cnt = await db.prepareRaw(
      `SELECT count(*) AS c FROM cutils_pg_t_${suffix} WHERE title = 'rolled'`,
    );
    const crow = await cnt.getOrNull([]);
    assert.equal(Number(crow.c), 0);

    // error path: unique violation code
    await db.exec(`INSERT INTO cutils_pg_t_${suffix} (id, title) VALUES (900, 'dup')`);
    await assert.rejects(
      () => db.exec(`INSERT INTO cutils_pg_t_${suffix} (id, title) VALUES (900, 'dup')`),
      (e) => e.code === "23505",
    );

    // validation through BOTH seam validators
    const { object, string, boolean, optional, number } = await import("valibot");
    const vSchema = object({ title: string(), done: optional(boolean()) });
    const vstmt = await db.prepare(
      `SELECT title, done FROM cutils_pg_t_${suffix} LIMIT 1`,
      vSchema,
    );
    const vrow = await vstmt.getOrNull([]);
    assert.equal(vrow.title, "hello");

    const badSchema = object({ title: number() });
    const badStmt = await db.prepare(
      `SELECT title, done FROM cutils_pg_t_${suffix} LIMIT 1`,
      badSchema,
    );
    await assert.rejects(
      () => badStmt.getOrNull([]),
      (e) => e.code === "VALIDATION",
    );

    // @chttp/val seam too
    const val = await import("@chttp/val");
    const cSchema = val.object({ title: val.string() });
    const cstmt = await db.prepare(
      `SELECT title, done FROM cutils_pg_t_${suffix} LIMIT 1`,
      cSchema,
    );
    const crow2 = await cstmt.getOrNull([]);
    assert.equal(crow2.title, "hello");

    // serverVersion
    assert.match(db.serverVersion, /^\d+/);

    // notify round-trip (LISTEN then NOTIFY)
    await db.exec(`LISTEN cutils_test_ch`);
    const nr = await db.notify("cutils_test_ch", "ping");
    assert.equal(nr.received.length, 1);
    assert.equal(nr.received[0].payload, "ping");

    // cancel a sleeping query — the cancel rides a fresh socket, but the stmt
    // must exist BEFORE the sleep since queries serialize on this connection.
    const sleepStmt = await db.prepareRaw("SELECT 1");
    const sleepQ = db.execute("SELECT pg_sleep(30)");
    await new Promise((r) => setTimeout(r, 300));
    await db.cancel(sleepStmt);
    await assert.rejects(sleepQ, (e) => e.code === "57014" || e.code === "CONNECTION");

    await db.exec(`DROP TABLE cutils_pg_t_${suffix}`);
  } finally {
    await db.close();
  }
});
