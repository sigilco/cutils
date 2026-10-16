// opmsg.test.mjs — OP_MSG framing: header fields, kind-0 body, kind-1
// document sequences, length checksumming, unknown-kind errors.

import test from "node:test";
import assert from "node:assert/strict";
import { encodeMsg, decodeMsg, DocSeq } from "../dist/esm/internal/opmsg.js";
import { vI32, vStr } from "../dist/esm/bson/value.js";
import { MongoError } from "../dist/esm/errors.js";

test("frame round-trip: header + kind-0 body", () => {
  const body = { hello: vI32(1), client: vStr("gate") };
  const frame = encodeMsg(42, body, []);
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.length);
  assert.equal(dv.getInt32(0, true), frame.length);
  assert.equal(dv.getInt32(4, true), 42); // requestId
  assert.equal(dv.getInt32(8, true), 0); // responseTo
  assert.equal(dv.getInt32(12, true), 2013); // opcode OP_MSG
  const msg = decodeMsg(frame);
  assert.equal(msg.requestId, 42);
  assert.equal(msg.responseTo, 0);
  assert.equal(msg.body.hello.v, 1);
  assert.equal(msg.body.client.v, "gate");
  assert.equal(msg.seqs.length, 0);
});

test("kind-1 document sequences round-trip", () => {
  const body = { insert: vStr("t") };
  const d1 = { _id: vI32(1), title: vStr("a") };
  const d2 = { _id: vI32(2), title: vStr("b") };
  const frame = encodeMsg(7, body, [new DocSeq("documents", [d1, d2])]);
  const msg = decodeMsg(frame);
  assert.equal(msg.seqs.length, 1);
  assert.equal(msg.seqs[0].id, "documents");
  assert.equal(msg.seqs[0].docs.length, 2);
  assert.equal(msg.seqs[0].docs[0].title.v, "a");
  assert.equal(msg.seqs[0].docs[1]._id.v, 2);
});

test("corrupt frames throw MongoError ProtocolError", () => {
  assert.throws(
    () => decodeMsg(new Uint8Array([1, 2, 3])),
    (e) => e instanceof MongoError && e.codeName === "ProtocolError",
  );
  const frame = encodeMsg(1, { ok: vI32(1) }, []);
  const bad = new Uint8Array(frame);
  bad[0] = 0; // clobber messageLength
  assert.throws(
    () => decodeMsg(bad),
    (e) => e instanceof MongoError && e.codeName === "ProtocolError",
  );
  const badOp = new Uint8Array(frame);
  new DataView(badOp.buffer).setInt32(12, 999, true);
  assert.throws(
    () => decodeMsg(badOp),
    (e) => e instanceof MongoError && e.codeName === "ProtocolError",
  );
});

test("checksum flag tolerated (sections stop 4 bytes early)", () => {
  const frame = new Uint8Array(encodeMsg(1, { ok: vI32(1) }, []));
  const withCrc = new Uint8Array(frame.length + 4);
  withCrc.set(frame);
  const dv = new DataView(withCrc.buffer);
  dv.setInt32(0, withCrc.length, true);
  dv.setUint32(16, 1, true); // checksumPresent
  // last 4 bytes: fake crc
  const msg = decodeMsg(withCrc);
  assert.equal(msg.body.ok.v, 1);
});
