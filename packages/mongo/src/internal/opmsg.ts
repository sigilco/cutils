// OP_MSG (opcode 2013) framing: 16-byte header, flagBits, then kind-0
// (single BSON body) and kind-1 (document sequence) sections. The driver
// never requests a checksum; when a reply carries one we stop section
// parsing 4 bytes early.

import { mongoError } from "../errors.ts";
import type { BsonDoc } from "../bson/value.ts";
import { BsonReader, BsonWriter, encodeDoc, readDocAt } from "./bson.ts";
import { utf8Decode, utf8Encode } from "./utf8.ts";

export const OP_MSG: number = 2013;
const FLAG_CHECKSUM: number = 1;
const FLAG_MORE_TO_COME: number = 2;

/** A kind-1 document sequence ("documents", "updates", "deletes"). */
export class DocSeq {
  id: string;
  docs: BsonDoc[];

  constructor(id: string, docs: BsonDoc[]) {
    this.id = id;
    this.docs = docs;
  }
}

export class OpMsg {
  requestId: number;
  responseTo: number;
  flags: number;
  body: BsonDoc;
  seqs: DocSeq[];

  constructor() {
    this.requestId = 0;
    this.responseTo = 0;
    this.flags = 0;
    this.body = {};
    this.seqs = [];
  }
}

function dv(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Encode an OP_MSG frame (header + body + document sequences). */
export function encodeMsg(requestId: number, body: BsonDoc, seqs: DocSeq[]): Uint8Array {
  const w = new BsonWriter();
  w.i32(0); // messageLength placeholder
  w.i32(requestId);
  w.i32(0); // responseTo
  w.i32(OP_MSG);
  w.i32(0); // flagBits — no checksum, no moreToCome, no exhaust
  w.u8(0); // section kind 0: single BSON body
  w.bytes(encodeDoc(body));
  for (let i = 0; i < seqs.length; i++) {
    const s = seqs[i];
    const sectionStart = w.pos;
    w.u8(1);
    w.i32(0); // section size placeholder
    w.bytes(utf8Encode(s.id));
    w.u8(0);
    for (let j = 0; j < s.docs.length; j++) {
      w.bytes(encodeDoc(s.docs[j]));
    }
    dv(w.buf).setInt32(sectionStart + 1, w.pos - sectionStart - 1, true);
  }
  dv(w.buf).setInt32(0, w.pos, true);
  return w.finish();
}

/** Decode one complete OP_MSG frame. Throws MongoError("ProtocolError"). */
export function decodeMsg(buf: Uint8Array): OpMsg {
  if (buf.length < 21) {
    throw mongoError("ProtocolError", "OP_MSG frame too short");
  }
  const d = dv(buf);
  const len = d.getInt32(0, true);
  if (len !== buf.length) {
    throw mongoError(
      "ProtocolError",
      "OP_MSG length mismatch: header " + String(len) + " vs buffer " + String(buf.length),
    );
  }
  const op = d.getInt32(12, true);
  if (op !== OP_MSG) {
    throw mongoError("ProtocolError", "unexpected opcode " + String(op));
  }
  const msg = new OpMsg();
  msg.requestId = d.getInt32(4, true);
  msg.responseTo = d.getInt32(8, true);
  msg.flags = d.getUint32(16, true);
  let end = len;
  if ((msg.flags & FLAG_CHECKSUM) !== 0) {
    end = end - 4;
  }
  const r = new BsonReader(buf);
  r.pos = 20;
  while (r.pos < end) {
    const kind = r.u8();
    if (kind === 0) {
      msg.body = readDocAt(r);
      continue;
    }
    if (kind === 1) {
      const size = r.i32();
      const seqEnd = r.pos + size - 4;
      let nul = r.pos;
      while (nul < seqEnd && buf[nul] !== 0) {
        nul = nul + 1;
      }
      const id = utf8Decode(buf.slice(r.pos, nul), nul - r.pos);
      r.pos = nul + 1;
      const docs: BsonDoc[] = [];
      while (r.pos < seqEnd) {
        docs.push(readDocAt(r));
      }
      msg.seqs.push(new DocSeq(id, docs));
      continue;
    }
    throw mongoError("ProtocolError", "unknown OP_MSG section kind " + String(kind));
  }
  return msg;
}
