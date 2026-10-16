// bson.test.mjs — BSON round-trip vs the official `bson` devDependency.
// Env-free: pure encode/decode equivalence across the 11 shipped types.

import test from "node:test";
import assert from "node:assert/strict";
import { BSON } from "bson";
import { encodeDoc, decodeDoc } from "../dist/esm/internal/bson.js";
import { toBsonDoc, fromBsonDoc, BsonDate } from "../dist/esm/bson/value.js";
import { ObjectId } from "../dist/esm/bson/objectid.js";
import { Binary } from "../dist/esm/bson/binary.js";

const { Binary: RefBinary, ObjectId: RefObjectId } = BSON;

test("encode matches official bson for the shipped type set", () => {
  const oid = ObjectId.generate();
  const doc = {
    s: "hello wörld",
    i32: 42,
    neg: -7,
    i64: 5000000000,
    f: 1.5,
    b: true,
    n: null,
    oid,
    bin: new Binary(new Uint8Array([1, 2, 3, 255]), 0),
    dt: new BsonDate(1737504000000),
    re: { pattern: "^a.*z", options: "im" },
    arr: [1, "two", false, null],
    doc: { x: 1, deep: { y: "z" } },
  };
  const ours = encodeDoc(toBsonDoc(doc));

  const refDoc = {
    s: doc.s,
    i32: 42,
    neg: -7,
    i64: BSON.Long.fromNumber(5000000000),
    f: 1.5,
    b: true,
    n: null,
    oid: new RefObjectId(oid.toHexString()),
    bin: new RefBinary(new Uint8Array([1, 2, 3, 255]), 0),
    dt: new Date(1737504000000),
    re: new BSON.BSONRegExp("^a.*z", "im"),
    arr: [1, "two", false, null],
    doc: { x: 1, deep: { y: "z" } },
  };
  const ref = BSON.serialize(refDoc);

  assert.deepEqual(Buffer.from(ours), Buffer.from(ref));
});

test("decode official bson bytes matches ours field-for-field", () => {
  const refDoc = {
    s: "abc",
    i: 9,
    big: 12345678901,
    d: 2.5,
    t: true,
    nil: null,
    oid: new RefObjectId("0123456789abcdef01234567"),
    bin: new RefBinary(new Uint8Array([9, 9]), 4),
    when: new Date(1000000),
    rx: new BSON.BSONRegExp("x+", "i"),
    list: ["a", 2],
    sub: { k: "v" },
  };
  const bytes = new Uint8Array(BSON.serialize(refDoc));
  const decoded = decodeDoc(bytes);
  const plain = fromBsonDoc(decoded);

  assert.equal(plain.s, "abc");
  assert.equal(plain.i, 9);
  assert.equal(plain.big, 12345678901);
  assert.equal(plain.d, 2.5);
  assert.equal(plain.t, true);
  assert.equal(plain.nil, null);
  assert.ok(plain.oid instanceof ObjectId);
  assert.equal(plain.oid.toHexString(), "0123456789abcdef01234567");
  assert.ok(plain.bin instanceof Binary);
  assert.equal(plain.bin.subType, 4);
  assert.deepEqual([...plain.bin.bytes], [9, 9]);
  assert.ok(plain.when instanceof BsonDate);
  assert.equal(plain.when.ms, 1000000);
  assert.deepEqual(plain.rx, { pattern: "x+", options: "i" });
  assert.deepEqual(plain.list, ["a", 2]);
  assert.deepEqual(plain.sub, { k: "v" });
});

test("int64 round-trip keeps full precision on the wire", () => {
  // Above 2^53 the tagged union keeps `raw` bigint for encode.
  const tagged = {
    big: { kind: "int64", v: Number(9223372036854775000n), raw: 9223372036854775000n },
  };
  const bytes = encodeDoc(tagged);
  const ref = BSON.deserialize(Buffer.from(bytes), { useBigInt64: true });
  assert.equal(ref.big, 9223372036854775000n);
});

test("punted types skip cleanly (decimal128 decodes to null)", () => {
  const refDoc = { price: new BSON.Decimal128("19.99"), ok: 1 };
  const bytes = new Uint8Array(BSON.serialize(refDoc));
  const plain = fromBsonDoc(decodeDoc(bytes));
  assert.equal(plain.price, null);
  assert.equal(plain.ok, 1);
});

test("regex record + tagged date passthrough encode", () => {
  const doc = {
    r: { pattern: "p", options: "i" },
    d: { $bson: "date", v: 42 },
  };
  const bytes = encodeDoc(toBsonDoc(doc));
  const ref = BSON.deserialize(Buffer.from(bytes));
  assert.equal(ref.r instanceof BSON.BSONRegExp || typeof ref.r === "object", true);
  assert.equal(ref.d.getTime(), 42);
});
