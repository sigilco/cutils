// Cursor state machines over find/aggregate firstBatch + getMore
// nextBatch. Batch draining is incremental; close issues killCursors when
// the server cursor is live. AsyncDisposable per spec; NO async iterator
// (subset doesn't lower it).

import { mongoError } from "../errors.ts";
import { getArr, getDoc, getI64Raw } from "../bson/value.ts";
import type { BsonDoc } from "../bson/value.ts";
import type { Session } from "./session.ts";
import { getMoreSpec, killCursorsSpec } from "./commands.ts";
import { DocSeq } from "./opmsg.ts";

export interface CursorInit {
  db: string;
  coll: string;
  batchSize: number | null;
  /** For reads inside a transaction: lsid/txnNumber fields applied to
   * getMore (startTransaction only on the first command). */
  txn: { lsid: BsonDoc; txnNumber: number } | null;
}

export class CursorCore implements AsyncDisposable {
  session: Session;
  db: string;
  coll: string;
  batchSize: number | null;
  txn: { lsid: BsonDoc; txnNumber: number } | null;
  /** Lossy f64 view of the server cursor id — for the `=== 0` checks and
   * any diagnostic surface. Wire encoding always uses `idRaw`. */
  id: number;
  /** Exact int64 cursor id: real ids are > 2^53, so only the raw bigint
   * survives a getMore/killCursors round-trip. */
  idRaw: bigint;
  buf: BsonDoc[];
  pos: number;
  done: boolean;
  closed: boolean;

  constructor(session: Session, init: CursorInit, body: BsonDoc) {
    this.session = session;
    this.db = init.db;
    this.coll = init.coll;
    this.batchSize = init.batchSize;
    this.txn = init.txn;
    this.buf = [];
    this.pos = 0;
    this.done = false;
    this.closed = false;
    const cursorDoc = getDoc(body, "cursor");
    if (cursorDoc === null) {
      throw mongoError("ProtocolError", "reply has no cursor document");
    }
    this.idRaw = getI64Raw(cursorDoc, "id");
    this.id = Number(this.idRaw);
    const first = getArr(cursorDoc, "firstBatch");
    const second = getArr(cursorDoc, "nextBatch");
    const batch = first.length > 0 ? first : second;
    for (let i = 0; i < batch.length; i++) {
      const v = batch[i];
      if (v.kind === "object") {
        this.buf.push(v.v);
      }
    }
    if (this.id === 0) {
      this.done = true;
    }
  }

  async getMore(): Promise<void> {
    const spec = getMoreSpec(this.idRaw, this.coll, this.batchSize);
    if (this.txn !== null) {
      spec["lsid"] = { kind: "object", v: this.txn.lsid };
      spec["txnNumber"] = { kind: "int64", v: this.txn.txnNumber, raw: BigInt(this.txn.txnNumber) };
      spec["autocommit"] = { kind: "boolean", v: false };
    }
    const body = await this.session.command(this.db, spec, []);
    const cursorDoc = getDoc(body, "cursor");
    if (cursorDoc === null) {
      throw mongoError("ProtocolError", "getMore reply has no cursor document");
    }
    this.idRaw = getI64Raw(cursorDoc, "id");
    this.id = Number(this.idRaw);
    const batch = getArr(cursorDoc, "nextBatch");
    this.buf = [];
    this.pos = 0;
    for (let i = 0; i < batch.length; i++) {
      const v = batch[i];
      if (v.kind === "object") {
        this.buf.push(v.v);
      }
    }
    if (this.id === 0) {
      this.done = true;
    }
  }

  /** Next document, or null at exhaustion. */
  async next(): Promise<BsonDoc | null> {
    if (this.closed) {
      throw mongoError("CursorClosed", "cursor is closed");
    }
    if (this.pos < this.buf.length) {
      const out = this.buf[this.pos];
      this.pos = this.pos + 1;
      return out;
    }
    if (this.done) {
      return null;
    }
    await this.getMore();
    if (this.pos < this.buf.length) {
      const out = this.buf[this.pos];
      this.pos = this.pos + 1;
      return out;
    }
    return null;
  }

  /** Next doc if already buffered — never hits the wire. */
  tryNext(): BsonDoc | null {
    if (this.closed) {
      throw mongoError("CursorClosed", "cursor is closed");
    }
    if (this.pos < this.buf.length) {
      const out = this.buf[this.pos];
      this.pos = this.pos + 1;
      return out;
    }
    return null;
  }

  /** True when a buffered doc exists or the server cursor is live. */
  hasNext(): boolean {
    if (this.closed) {
      return false;
    }
    return this.pos < this.buf.length || !this.done;
  }

  /** Drain the cursor into an array. */
  async all(): Promise<BsonDoc[]> {
    const out: BsonDoc[] = [];
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return out;
      }
      out.push(d);
    }
  }

  async forEach(cb: (doc: BsonDoc) => void): Promise<void> {
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return;
      }
      cb(d);
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.id !== 0 && this.session.connected) {
      try {
        await this.session.command(this.db, killCursorsSpec(this.coll, [this.idRaw]), []);
      } catch (_e) {
        // Best-effort — a dead socket must not leak a throw from dispose.
      }
    }
    this.id = 0;
    this.idRaw = BigInt(0);
    this.done = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
