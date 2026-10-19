// cursor.test.mjs — cursor surface over canned firstBatch/nextBatch
// replies: next/tryNext/hasNext/all/forEach/close + killCursors. Uses a
// plain-object fake session (JS duck-typing — no server).

import test from "node:test";
import assert from "node:assert/strict";
import { CursorCore } from "../dist/esm/internal/cursor.js";
import { MongoError } from "../dist/esm/errors.js";
import { vI64, vI64Raw, vObj } from "../dist/esm/bson/value.js";

function cursorBody(id, batchKey, docs) {
  const cursor = { id: vI64Raw(BigInt(id)), ns: { kind: "string", v: "db.t" } };
  cursor[batchKey] = { kind: "array", v: docs.map((d) => vObj(d)) };
  return { ok: { kind: "double", v: 1 }, cursor: vObj(cursor) };
}

function fakeSession(batches) {
  const calls = [];
  let i = 0;
  return {
    calls,
    connected: true,
    async command(_db, spec, _seqs) {
      calls.push(spec);
      if (typeof spec.getMore !== "undefined") {
        const b = batches[i];
        i = i + 1;
        return cursorBody(b.id, "nextBatch", b.docs);
      }
      if (typeof spec.killCursors !== "undefined") {
        return {
          ok: { kind: "double", v: 1 },
          cursorsKilled: { kind: "array", v: [vI64(spec.cursors.v[0].v)] },
        };
      }
      throw new Error("unexpected command " + JSON.stringify(spec));
    },
  };
}

const init = { db: "db", coll: "t", batchSize: null, txn: null };

test("next drains firstBatch then getMores to exhaustion", async () => {
  const first = cursorBody(99, "firstBatch", [{ a: vI64(1) }, { a: vI64(2) }]);
  const session = fakeSession([
    { id: 99, docs: [{ a: vI64(3) }] },
    { id: 0, docs: [] },
  ]);
  const cur = new CursorCore(session, init, first);
  assert.equal((await cur.next()).a.v, 1);
  assert.equal((await cur.next()).a.v, 2);
  assert.equal((await cur.next()).a.v, 3);
  assert.equal(await cur.next(), null);
  assert.equal(session.calls.length, 2); // two getMores
  assert.equal(session.calls[0].getMore.v, 99);
});

test("getMore/killCursors re-encode >2^53 cursor ids losslessly (#32)", async () => {
  // Real mongod cursor ids are random int64s, almost always above the
  // f64 safe-integer bound — the lossy getNum path rounded this to
  // ...592 and the server answered CursorNotFound (code 43).
  const big = 2166240671379054593n; // Number(big) === ...592 — f64-lossy
  const first = cursorBody(big, "firstBatch", [{ a: vI64(1) }]);
  const session = fakeSession([
    { id: big, docs: [{ a: vI64(2) }] },
    { id: 0n, docs: [] },
  ]);
  const cur = new CursorCore(session, init, first);
  assert.equal((await cur.next()).a.v, 1);
  assert.equal((await cur.next()).a.v, 2); // getMore fired
  assert.equal(session.calls[0].getMore.raw, big);

  const cur2 = new CursorCore(session, init, cursorBody(big, "firstBatch", [{ a: vI64(9) }]));
  await cur2.close();
  assert.equal(session.calls[1].cursors.v[0].raw, big);
});

test("tryNext only returns buffered docs; hasNext reflects liveness", async () => {
  const first = cursorBody(7, "firstBatch", [{ a: vI64(1) }]);
  const session = fakeSession([{ id: 0, docs: [] }]);
  const cur = new CursorCore(session, init, first);
  assert.equal(cur.hasNext(), true);
  assert.equal(cur.tryNext().a.v, 1);
  assert.equal(cur.tryNext(), null);
  assert.equal(cur.hasNext(), true); // live server cursor
  await cur.next(); // getMore -> id 0, empty
  assert.equal(cur.hasNext(), false);
});

test("all() collects everything; forEach visits in order", async () => {
  const first = cursorBody(0, "firstBatch", [{ a: vI64(1) }, { a: vI64(2) }]);
  const session = fakeSession([]);
  const cur = new CursorCore(session, init, first);
  const all = await cur.all();
  assert.equal(all.length, 2);

  const cur2 = new CursorCore(session, init, cursorBody(0, "firstBatch", [{ a: vI64(9) }]));
  const seen = [];
  await cur2.forEach((d) => seen.push(d.a.v));
  assert.deepEqual(seen, [9]);
});

test("close issues killCursors for a live cursor; next after close throws", async () => {
  const first = cursorBody(55, "firstBatch", [{ a: vI64(1) }]);
  const session = fakeSession([]);
  const cur = new CursorCore(session, init, first);
  await cur.close();
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].killCursors.v, "t");
  await assert.rejects(cur.next(), (e) => e instanceof MongoError && e.codeName === "CursorClosed");
});

test("dead cursor (id 0) closes without a command", async () => {
  const session = fakeSession([]);
  const cur = new CursorCore(session, init, cursorBody(0, "firstBatch", []));
  await cur.close();
  assert.equal(session.calls.length, 0);
});
