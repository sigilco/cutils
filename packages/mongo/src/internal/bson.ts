// BSON parser/serializer over the `BsonDoc` tagged union — the 11 shipped
// BSON types (double, string, object, array, binary, objectId, boolean,
// date, null, regex, int32, int64). Punted types (decimal128, timestamp,
// dbRef, symbol, code, minKey/maxKey) decode as their tag suggests where
// cheap (timestamp/dbRef/symbol -> their nearest shipped view) and skip
// otherwise; encode never emits them.

import { mongoError } from "../errors.ts";
import type { BsonDoc, BsonValue } from "../bson/value.ts";
import { ObjectId } from "../bson/objectid.ts";
import {
  vArr,
  vBin,
  vBool,
  vDateMs,
  vDouble,
  vI32,
  vI64Raw,
  vNull,
  vObj,
  vOid,
  vRegex,
  vStr,
} from "../bson/value.ts";
import { utf8Decode, utf8Encode } from "./utf8.ts";

const TAG_DOUBLE: number = 0x01;
const TAG_STRING: number = 0x02;
const TAG_OBJECT: number = 0x03;
const TAG_ARRAY: number = 0x04;
const TAG_BINARY: number = 0x05;
const TAG_OBJECTID: number = 0x07;
const TAG_BOOLEAN: number = 0x08;
const TAG_DATE: number = 0x09;
const TAG_NULL: number = 0x0a;
const TAG_REGEX: number = 0x0b;
const TAG_DBREF: number = 0x0c;
const TAG_CODE: number = 0x0d;
const TAG_SYMBOL: number = 0x0e;
const TAG_CODEWSCOPE: number = 0x0f;
const TAG_INT32: number = 0x10;
const TAG_TIMESTAMP: number = 0x11;
const TAG_INT64: number = 0x12;
const TAG_DECIMAL128: number = 0x13;
const TAG_MINKEY: number = 0xff;
const TAG_MAXKEY: number = 0x7f;

// ---------- writer ------------------------------------------------------

export class BsonWriter {
  buf: Uint8Array;
  pos: number;

  constructor() {
    this.buf = new Uint8Array(1024);
    this.pos = 0;
  }

  ensure(n: number): void {
    if (this.pos + n <= this.buf.length) {
      return;
    }
    let cap = this.buf.length;
    while (this.pos + n > cap) {
      cap = cap * 2;
    }
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos] = v & 255;
    this.pos = this.pos + 1;
  }

  i32(v: number): void {
    this.ensure(4);
    const dv = new DataView(this.buf.buffer);
    dv.setInt32(this.pos, v, true);
    this.pos = this.pos + 4;
  }

  i64(v: bigint): void {
    this.ensure(8);
    const dv = new DataView(this.buf.buffer);
    dv.setBigInt64(this.pos, v, true);
    this.pos = this.pos + 8;
  }

  f64(v: number): void {
    this.ensure(8);
    const dv = new DataView(this.buf.buffer);
    dv.setFloat64(this.pos, v, true);
    this.pos = this.pos + 8;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos = this.pos + b.length;
  }

  cstr(s: string): void {
    const b = utf8Encode(s);
    this.bytes(b);
    this.u8(0);
  }

  str(s: string): void {
    const b = utf8Encode(s);
    this.i32(b.length + 1);
    this.bytes(b);
    this.u8(0);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

function writeElement(w: BsonWriter, key: string, v: BsonValue): void {
  switch (v.kind) {
    case "double":
      w.u8(TAG_DOUBLE);
      w.cstr(key);
      w.f64(v.v);
      return;
    case "string":
      w.u8(TAG_STRING);
      w.cstr(key);
      w.str(v.v);
      return;
    case "object":
      w.u8(TAG_OBJECT);
      w.cstr(key);
      w.bytes(encodeDoc(v.v));
      return;
    case "array": {
      w.u8(TAG_ARRAY);
      w.cstr(key);
      const sub: BsonDoc = {};
      for (let i = 0; i < v.v.length; i++) {
        sub[String(i)] = v.v[i];
      }
      w.bytes(encodeDoc(sub));
      return;
    }
    case "binary":
      w.u8(TAG_BINARY);
      w.cstr(key);
      w.i32(v.v.length);
      w.u8(v.subType);
      w.bytes(v.v);
      return;
    case "objectId":
      w.u8(TAG_OBJECTID);
      w.cstr(key);
      w.bytes(ObjectId.fromHex(v.v).bytes);
      return;
    case "boolean":
      w.u8(TAG_BOOLEAN);
      w.cstr(key);
      w.u8(v.v ? 1 : 0);
      return;
    case "date":
      w.u8(TAG_DATE);
      w.cstr(key);
      w.i64(BigInt(v.v));
      return;
    case "null":
      w.u8(TAG_NULL);
      w.cstr(key);
      return;
    case "regex":
      w.u8(TAG_REGEX);
      w.cstr(key);
      w.cstr(v.pattern);
      w.cstr(v.options);
      return;
    case "int32":
      w.u8(TAG_INT32);
      w.cstr(key);
      w.i32(v.v);
      return;
    case "int64":
      w.u8(TAG_INT64);
      w.cstr(key);
      w.i64(v.raw);
      return;
  }
}

/** Serialize a tagged document to BSON bytes. */
export function encodeDoc(doc: BsonDoc): Uint8Array {
  const w = new BsonWriter();
  const start = w.pos;
  w.i32(0); // length placeholder
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    writeElement(w, k, doc[k]);
  }
  w.u8(0);
  const len = w.pos - start;
  const dv = new DataView(w.buf.buffer);
  dv.setInt32(start, len, true);
  return w.finish();
}

// ---------- reader ------------------------------------------------------

export class BsonReader {
  buf: Uint8Array;
  pos: number;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.pos = 0;
  }

  u8(): number {
    const v = this.buf[this.pos];
    this.pos = this.pos + 1;
    return v;
  }

  i32(): number {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = dv.getInt32(this.pos, true);
    this.pos = this.pos + 4;
    return v;
  }

  i64(): bigint {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = dv.getBigInt64(this.pos, true);
    this.pos = this.pos + 8;
    return v;
  }

  f64(): number {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = dv.getFloat64(this.pos, true);
    this.pos = this.pos + 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    const v = this.buf.slice(this.pos, this.pos + n);
    this.pos = this.pos + n;
    return v;
  }

  cstr(): string {
    let end = this.pos;
    while (end < this.buf.length && this.buf[end] !== 0) {
      end = end + 1;
    }
    const s = utf8Decode(this.buf.slice(this.pos, end), end - this.pos);
    this.pos = end + 1;
    return s;
  }

  str(): string {
    const n = this.i32();
    const b = this.bytes(n);
    // n includes the trailing NUL.
    return utf8Decode(b, n - 1);
  }
}

function readArray(r: BsonReader, len: number): BsonValue[] {
  const doc = readDocBody(r, len);
  const out: BsonValue[] = [];
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    out.push(doc[keys[i]]);
  }
  return out;
}

function skipValue(r: BsonReader, tag: number): void {
  switch (tag) {
    case TAG_DOUBLE:
    case TAG_DATE:
    case TAG_INT64:
    case TAG_TIMESTAMP:
      r.bytes(8);
      return;
    case TAG_INT32:
      r.bytes(4);
      return;
    case TAG_BOOLEAN:
      r.bytes(1);
      return;
    case TAG_NULL:
    case TAG_MINKEY:
    case TAG_MAXKEY:
      return;
    case TAG_OBJECTID:
      r.bytes(12);
      return;
    case TAG_DECIMAL128:
      r.bytes(16);
      return;
    case TAG_STRING:
    case TAG_SYMBOL:
    case TAG_CODE: {
      const n = r.i32();
      r.bytes(n);
      return;
    }
    case TAG_BINARY: {
      const n = r.i32();
      r.bytes(1);
      r.bytes(n);
      return;
    }
    case TAG_OBJECT:
    case TAG_ARRAY:
    case TAG_DBREF:
    case TAG_CODEWSCOPE: {
      const n = r.i32();
      r.bytes(n - 4);
      return;
    }
    case TAG_REGEX:
      r.cstr();
      r.cstr();
      return;
    default:
      throw mongoError("BsonCorrupt", "unknown BSON tag 0x" + tag.toString(16));
  }
}

function readValue(r: BsonReader, tag: number): BsonValue {
  switch (tag) {
    case TAG_DOUBLE:
      return vDouble(r.f64());
    case TAG_STRING:
      return vStr(r.str());
    case TAG_OBJECT: {
      const n = r.i32();
      return vObj(readDocBody(r, n));
    }
    case TAG_ARRAY: {
      const n = r.i32();
      return vArr(readArray(r, n));
    }
    case TAG_BINARY: {
      const n = r.i32();
      const st = r.u8();
      return vBin(r.bytes(n), st);
    }
    case TAG_OBJECTID: {
      const b = r.bytes(12);
      return vOid(new ObjectId(b).toHexString());
    }
    case TAG_BOOLEAN:
      return vBool(r.u8() !== 0);
    case TAG_DATE:
      return vDateMs(Number(r.i64()));
    case TAG_NULL:
      return vNull();
    case TAG_REGEX: {
      const p = r.cstr();
      const o = r.cstr();
      return vRegex(p, o);
    }
    case TAG_INT32:
      return vI32(r.i32());
    case TAG_INT64:
      return vI64Raw(r.i64());
    default:
      // Punted types: skip the bytes, decode as null so a document with
      // e.g. a Decimal128 field still parses (the field value is gone —
      // same lossy stance as int64 -> number).
      skipValue(r, tag);
      return vNull();
  }
}

/** Read a document body of `len` total bytes (len includes its own int32
 * and the trailing NUL) starting after the length field. */
function readDocBody(r: BsonReader, len: number): BsonDoc {
  const end = r.pos + len - 4;
  const doc: BsonDoc = {};
  for (;;) {
    if (r.pos >= end) {
      throw mongoError("BsonCorrupt", "document overruns its declared length");
    }
    const tag = r.u8();
    if (tag === 0) {
      if (r.pos !== end) {
        r.pos = end;
      }
      return doc;
    }
    const key = r.cstr();
    doc[key] = readValue(r, tag);
  }
}

/** Decode one BSON document positioned at `r.pos`. */
export function readDocAt(r: BsonReader): BsonDoc {
  const len = r.i32();
  if (len < 5) {
    throw mongoError("BsonCorrupt", "invalid document length " + String(len));
  }
  return readDocBody(r, len);
}

/** Decode a buffer holding exactly one BSON document. */
export function decodeDoc(buf: Uint8Array): BsonDoc {
  const r = new BsonReader(buf);
  return readDocAt(r);
}
