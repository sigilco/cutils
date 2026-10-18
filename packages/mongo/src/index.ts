// @cutils/mongo — hand-rolled async MongoDB wire driver (OP_MSG + BSON over
// node:net / node:tls / node:crypto, no FFI) in the scriptc-compilable
// subset. Public surface per `.agents/plans/2026-10-15-cutils-mongo.md`.
//
// Generic-looking public classes (Collection<TDoc>, FindCursor<TDoc>,
// AggregateCursor<TOut>) ship as concrete `*Core` classes plus type-level
// `interface X<T> extends XCore` + `const X = XCore` aliases — generic
// class instances degrade to methodless shells under scriptc 0.3.x.

import { mongoError } from "./errors.ts";
import { fromBsonDoc, toBsonDoc } from "./bson/value.ts";
import type { BsonDoc } from "./bson/value.ts";
import { getArr, getNum, getVal, vObj } from "./bson/value.ts";
import { ObjectId } from "./bson/objectid.ts";
import { Session, type SessionOpts } from "./internal/session.ts";
import { CursorCore } from "./internal/cursor.ts";
import { TxnState } from "./internal/transaction.ts";
import { DocSeq } from "./internal/opmsg.ts";
import {
  abortTxnSpec,
  aggregateSpec,
  commitTxnSpec,
  countSpec,
  deleteEntry,
  deleteSpec,
  distinctSpec,
  findAndModifySpec,
  findSpec,
  insertSpec,
  txnFields,
  updateEntry,
  updateSpec,
} from "./internal/commands.ts";
import { validateDoc } from "./validate.ts";
import type {
  BulkWriteResult,
  ConnectOpts,
  Document,
  FindOpts,
  StandardSchemaV1,
  TransactionOpts,
  WithoutId,
  WriteOp,
} from "./types.ts";

export { mongoError, MongoError } from "./errors.ts";
export { ObjectId } from "./bson/objectid.ts";
export { Binary } from "./bson/binary.ts";
export { BsonDate } from "./bson/value.ts";
export type {
  BsonPrimitive,
  BulkWriteResult,
  ConnectOpts,
  Document,
  FindOpts,
  InferOutput,
  TransactionOpts,
  WithId,
  WithoutId,
  WriteOp,
} from "./types.ts";
export { StdProps, StandardSchemaV1 } from "./types.ts";

// ---------- options plumbing --------------------------------------------

interface Opts {
  uri: string;
  dbName: string;
  appName: string;
  connectTimeoutMs: number;
  retryReads: boolean;
  retryWrites: boolean;
}

function optsFrom(o: ConnectOpts): Opts {
  const out: Opts = {
    uri: o.uri,
    dbName: o.dbName,
    appName: "",
    connectTimeoutMs: 10000,
    retryReads: true,
    retryWrites: true,
  };
  if (typeof o.appName !== "undefined") {
    out.appName = o.appName;
  }
  if (typeof o.connectTimeoutMs !== "undefined") {
    out.connectTimeoutMs = o.connectTimeoutMs;
  }
  if (typeof o.retryReads !== "undefined") {
    out.retryReads = o.retryReads;
  }
  if (typeof o.retryWrites !== "undefined") {
    out.retryWrites = o.retryWrites;
  }
  return out;
}

// ---------- MongoClient ---------------------------------------------------

export class MongoClient implements AsyncDisposable {
  session: Session;
  opts: Opts;
  dbName: string;

  constructor(session: Session, opts: Opts) {
    this.session = session;
    this.opts = opts;
    this.dbName = opts.dbName;
  }

  static async connect(opts: ConnectOpts): Promise<MongoClient> {
    const o = optsFrom(opts);
    const sessionOpts: SessionOpts = {
      uri: o.uri,
      appName: o.appName,
      connectTimeoutMs: o.connectTimeoutMs,
      retryReads: o.retryReads,
      retryWrites: o.retryWrites,
    };
    const session = new Session(sessionOpts);
    await session.connect();
    return new MongoClient(session, o);
  }

  /** A database handle — the opts' dbName when `name` is empty. */
  database(name?: string): Database {
    let n = this.dbName;
    if (typeof name !== "undefined" && name !== "") {
      n = name;
    }
    const db = new Database(this.session, n, null);
    db.client = this;
    return db;
  }

  /** All reads on the returned Database validate through `schema`. */
  withSchema(schema: StandardSchemaV1): Database {
    const db = new Database(this.session, this.dbName, schema);
    db.client = this;
    return db;
  }

  startTransaction(opts?: TransactionOpts): Transaction {
    const txn = new Transaction(this.session, opts === undefined ? null : opts);
    txn.begin();
    return txn;
  }

  async close(): Promise<void> {
    this.session.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// ---------- Database ------------------------------------------------------

export class Database implements AsyncDisposable {
  client: MongoClient | null;
  session: Session;
  name: string;
  schema: StandardSchemaV1 | null;

  constructor(session: Session, name: string, schema: StandardSchemaV1 | null) {
    this.client = null;
    this.session = session;
    this.name = name;
    this.schema = schema;
  }

  collection<TDoc extends Document = Document>(name: string): Collection<TDoc> {
    return new CollectionCore(this, name);
  }

  /** Raw admin/read command on this database. */
  async command(spec: Document): Promise<Document> {
    const body = await this.session.commandMaybeRetry(this.name, toBsonDoc(spec), [], "admin");
    return fromBsonDoc(body);
  }

  startTransaction(opts?: TransactionOpts): Transaction {
    const txn = new Transaction(this.session, opts === undefined ? null : opts);
    txn.begin();
    return txn;
  }

  async close(): Promise<void> {
    this.session.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// ---------- Collection -----------------------------------------------------

export class CollectionCore implements AsyncDisposable {
  db: Database;
  name: string;

  constructor(db: Database, name: string) {
    this.db = db;
    this.name = name;
  }

  session(): Session {
    return this.db.session;
  }

  dbName(): string {
    return this.db.name;
  }

  /** Validate `doc` through the Database schema when one is set. */
  async validate(doc: BsonDoc): Promise<Document> {
    const schema = this.db.schema;
    const plain = fromBsonDoc(doc);
    if (schema === null) {
      return plain;
    }
    return validateDoc(schema, plain);
  }

  async insertOne(doc: WithoutId<Document>): Promise<ObjectId> {
    const docs: BsonDoc[] = [toBsonDoc(doc as Document)];
    let oid = "";
    const hasId = typeof (doc as Document)["_id"] !== "undefined";
    if (!hasId) {
      const generated = ObjectId.generate();
      // Assigning the tagged literal straight into docs[0] trips SC9001
      // ("recordKeySet receiver: expected record, got union") — rebuild the
      // first document and write it back instead.
      const first: BsonDoc = toBsonDoc(doc as Document);
      first["_id"] = { kind: "objectId", v: generated.toHexString() };
      docs[0] = first;
      oid = generated.toHexString();
    } else {
      const idv = (doc as Document)["_id"];
      if (idv instanceof ObjectId) {
        oid = idv.toHexString();
      }
    }
    const seq = new DocSeq("documents", docs);
    await this.session().commandMaybeRetry(this.dbName(), insertSpec(this.name), [seq], "write");
    return oid === "" ? ObjectId.generate() : ObjectId.fromHex(oid);
  }

  async insertMany(docs: WithoutId<Document>[]): Promise<ObjectId[]> {
    const wire: BsonDoc[] = [];
    const ids: ObjectId[] = [];
    for (let i = 0; i < docs.length; i++) {
      const d = toBsonDoc(docs[i] as Document);
      if (typeof docs[i]["_id"] === "undefined") {
        const generated = ObjectId.generate();
        d["_id"] = { kind: "objectId", v: generated.toHexString() };
        ids.push(generated);
      } else {
        const idv = docs[i]["_id"];
        if (idv instanceof ObjectId) {
          ids.push(idv);
        } else {
          ids.push(ObjectId.generate());
        }
      }
      wire.push(d);
    }
    const seq = new DocSeq("documents", wire);
    await this.session().commandMaybeRetry(this.dbName(), insertSpec(this.name), [seq], "write");
    return ids;
  }

  async findOne(filter: Partial<Document>, opts?: FindOpts): Promise<Document | null> {
    const o: FindOpts = opts === undefined ? {} : opts;
    o.limit = 1;
    const spec = findSpec(this.name, toBsonDoc(filter as Document), o);
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "read");
    const init: { db: string; coll: string; batchSize: number | null; txn: null } = {
      db: this.dbName(),
      coll: this.name,
      batchSize: null,
      txn: null,
    };
    const cursor = new CursorCore(this.session(), init, body);
    const doc = await cursor.next();
    await cursor.close();
    if (doc === null) {
      return null;
    }
    return this.validate(doc);
  }

  find(filter: Partial<Document>, opts?: FindOpts): FindCursor<Document> {
    return new FindCursorCore(
      this,
      toBsonDoc(filter as Document),
      opts === undefined ? null : opts,
    );
  }

  async updateOne(filter: Partial<Document>, update: Document, upsert?: boolean): Promise<number> {
    return this.update(filter, update, upsert === true, false);
  }

  async updateMany(filter: Partial<Document>, update: Document, upsert?: boolean): Promise<number> {
    return this.update(filter, update, upsert === true, true);
  }

  async update(
    filter: Partial<Document>,
    update: Document,
    upsert: boolean,
    multi: boolean,
  ): Promise<number> {
    const entry = updateEntry(toBsonDoc(filter as Document), toBsonDoc(update), upsert, multi);
    const seq = new DocSeq("updates", [entry]);
    const body = await this.session().commandMaybeRetry(
      this.dbName(),
      updateSpec(this.name),
      [seq],
      "write",
    );
    return getNum(body, "n");
  }

  async deleteOne(filter: Partial<Document>): Promise<number> {
    return this.deleteDocs(filter, 1);
  }

  async deleteMany(filter: Partial<Document>): Promise<number> {
    return this.deleteDocs(filter, 0);
  }

  async deleteDocs(filter: Partial<Document>, limit: number): Promise<number> {
    const entry = deleteEntry(toBsonDoc(filter as Document), limit);
    const seq = new DocSeq("deletes", [entry]);
    const body = await this.session().commandMaybeRetry(
      this.dbName(),
      deleteSpec(this.name),
      [seq],
      "write",
    );
    return getNum(body, "n");
  }

  async findOneAndUpdate(filter: Partial<Document>, update: Document): Promise<Document | null> {
    const spec = findAndModifySpec(
      this.name,
      toBsonDoc(filter as Document),
      toBsonDoc(update),
      false,
      true,
    );
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "write");
    const v = getVal(body, "value");
    if (v === null || v.kind !== "object") {
      return null;
    }
    return this.validate(v.v);
  }

  async findOneAndDelete(filter: Partial<Document>): Promise<Document | null> {
    const spec = findAndModifySpec(this.name, toBsonDoc(filter as Document), null, true, false);
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "write");
    const v = getVal(body, "value");
    if (v === null || v.kind !== "object") {
      return null;
    }
    return this.validate(v.v);
  }

  async countDocuments(filter: Partial<Document>): Promise<number> {
    const spec = countSpec(this.name, toBsonDoc(filter as Document));
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "read");
    return getNum(body, "n");
  }

  async estimatedDocumentCount(): Promise<number> {
    const spec: BsonDoc = {};
    spec["count"] = { kind: "string", v: this.name };
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "read");
    return getNum(body, "n");
  }

  async distinct(key: string, filter?: Partial<Document>): Promise<unknown[]> {
    const spec = distinctSpec(
      this.name,
      key,
      toBsonDoc((filter === undefined ? {} : filter) as Document),
    );
    const body = await this.session().commandMaybeRetry(this.dbName(), spec, [], "read");
    const values = getArr(body, "values");
    const out: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const tmp: BsonDoc = { v: v };
      out.push(fromBsonDoc(tmp)["v"]);
    }
    return out;
  }

  async bulkWrite(ops: WriteOp<Document>[]): Promise<BulkWriteResult> {
    const result: BulkWriteResult = {
      insertedCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      deletedCount: 0,
    };
    const updates: BsonDoc[] = [];
    const deletes: BsonDoc[] = [];
    const inserts: BsonDoc[] = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.type === "insert") {
        inserts.push(toBsonDoc(op.doc as Document));
      } else if (op.type === "updateOne") {
        updates.push(
          updateEntry(
            toBsonDoc(op.filter as Document),
            toBsonDoc(op.update),
            op.upsert === true,
            false,
          ),
        );
      } else if (op.type === "updateMany") {
        updates.push(
          updateEntry(
            toBsonDoc(op.filter as Document),
            toBsonDoc(op.update),
            op.upsert === true,
            true,
          ),
        );
      } else if (op.type === "deleteOne") {
        deletes.push(deleteEntry(toBsonDoc(op.filter as Document), 1));
      } else if (op.type === "deleteMany") {
        deletes.push(deleteEntry(toBsonDoc(op.filter as Document), 0));
      } else if (op.type === "replaceOne") {
        updates.push(
          updateEntry(
            toBsonDoc(op.filter as Document),
            toBsonDoc(op.replacement as Document),
            op.upsert === true,
            false,
          ),
        );
      }
    }
    if (inserts.length > 0) {
      const seq = new DocSeq("documents", inserts);
      await this.session().commandMaybeRetry(this.dbName(), insertSpec(this.name), [seq], "write");
      result.insertedCount = inserts.length;
    }
    if (updates.length > 0) {
      const seq = new DocSeq("updates", updates);
      const body = await this.session().commandMaybeRetry(
        this.dbName(),
        updateSpec(this.name),
        [seq],
        "write",
      );
      result.matchedCount = getNum(body, "n");
      result.modifiedCount = getNum(body, "nModified");
      const upserted = getArr(body, "upserted");
      result.upsertedCount = upserted.length;
    }
    if (deletes.length > 0) {
      const seq = new DocSeq("deletes", deletes);
      const body = await this.session().commandMaybeRetry(
        this.dbName(),
        deleteSpec(this.name),
        [seq],
        "write",
      );
      result.deletedCount = getNum(body, "n");
    }
    return result;
  }

  aggregate<TOut extends Document = Document>(pipeline: Document[]): AggregateCursor<TOut> {
    const stages: BsonDoc[] = [];
    for (let i = 0; i < pipeline.length; i++) {
      stages.push(toBsonDoc(pipeline[i]));
    }
    return new AggregateCursorCore(this, stages);
  }

  async close(): Promise<void> {
    // No-op — collections don't own resources; the client does.
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** `Collection<TDoc>` — generic-looking alias over the concrete core. */
export interface Collection<TDoc extends Document = Document> extends CollectionCore {}
export const Collection = CollectionCore;

// ---------- cursors --------------------------------------------------------

export class FindCursorCore implements AsyncDisposable {
  coll: CollectionCore;
  filter: BsonDoc;
  opts: FindOpts | null;
  inner: CursorCore | null;
  started: boolean;

  constructor(coll: CollectionCore, filter: BsonDoc, opts: FindOpts | null) {
    this.coll = coll;
    this.filter = filter;
    this.opts = opts;
    this.inner = null;
    this.started = false;
  }

  async ensure(): Promise<CursorCore> {
    if (this.inner !== null) {
      return this.inner;
    }
    const spec = findSpec(this.coll.name, this.filter, this.opts);
    const body = await this.coll.session().commandMaybeRetry(this.coll.dbName(), spec, [], "read");
    let batchSize: number | null = null;
    if (this.opts !== null && typeof this.opts.batchSize !== "undefined") {
      batchSize = this.opts.batchSize;
    }
    const init: { db: string; coll: string; batchSize: number | null; txn: null } = {
      db: this.coll.dbName(),
      coll: this.coll.name,
      batchSize: batchSize,
      txn: null,
    };
    this.inner = new CursorCore(this.coll.session(), init, body);
    this.started = true;
    return this.inner;
  }

  async next(): Promise<Document | null> {
    const c = await this.ensure();
    const doc = await c.next();
    if (doc === null) {
      return null;
    }
    return this.coll.validate(doc);
  }

  async tryNext(): Promise<Document | null> {
    if (this.inner === null) {
      return null;
    }
    const doc = this.inner.tryNext();
    if (doc === null) {
      return null;
    }
    return this.coll.validate(doc);
  }

  async hasNext(): Promise<boolean> {
    const c = await this.ensure();
    return c.hasNext();
  }

  async all(): Promise<Document[]> {
    const out: Document[] = [];
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return out;
      }
      out.push(d);
    }
  }

  async forEach(cb: (doc: Document) => void): Promise<void> {
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return;
      }
      cb(d);
    }
  }

  async close(): Promise<void> {
    if (this.inner !== null) {
      await this.inner.close();
      this.inner = null;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export interface FindCursor<TDoc extends Document = Document> extends FindCursorCore {}
export const FindCursor = FindCursorCore;

export class AggregateCursorCore implements AsyncDisposable {
  coll: CollectionCore;
  pipeline: BsonDoc[];
  inner: CursorCore | null;

  constructor(coll: CollectionCore, pipeline: BsonDoc[]) {
    this.coll = coll;
    this.pipeline = pipeline;
    this.inner = null;
  }

  async ensure(): Promise<CursorCore> {
    if (this.inner !== null) {
      return this.inner;
    }
    const spec = aggregateSpec(this.coll.name, this.pipeline);
    const body = await this.coll.session().commandMaybeRetry(this.coll.dbName(), spec, [], "read");
    const init: { db: string; coll: string; batchSize: number | null; txn: null } = {
      db: this.coll.dbName(),
      coll: this.coll.name,
      batchSize: null,
      txn: null,
    };
    this.inner = new CursorCore(this.coll.session(), init, body);
    return this.inner;
  }

  async next(): Promise<Document | null> {
    const c = await this.ensure();
    const doc = await c.next();
    if (doc === null) {
      return null;
    }
    return this.coll.validate(doc);
  }

  async tryNext(): Promise<Document | null> {
    if (this.inner === null) {
      return null;
    }
    const doc = this.inner.tryNext();
    if (doc === null) {
      return null;
    }
    return this.coll.validate(doc);
  }

  async hasNext(): Promise<boolean> {
    const c = await this.ensure();
    return c.hasNext();
  }

  async all(): Promise<Document[]> {
    const out: Document[] = [];
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return out;
      }
      out.push(d);
    }
  }

  async forEach(cb: (doc: Document) => void): Promise<void> {
    for (;;) {
      const d = await this.next();
      if (d === null) {
        return;
      }
      cb(d);
    }
  }

  async close(): Promise<void> {
    if (this.inner !== null) {
      await this.inner.close();
      this.inner = null;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export interface AggregateCursor<TOut extends Document = Document> extends AggregateCursorCore {}
export const AggregateCursor = AggregateCursorCore;

// ---------- Transaction -----------------------------------------------------

export class Transaction implements AsyncDisposable {
  session: Session;
  opts: TransactionOpts | null;
  state: TxnState;
  dbName: string;

  constructor(session: Session, opts: TransactionOpts | null) {
    this.session = session;
    this.opts = opts;
    this.state = new TxnState();
    this.dbName = "";
  }

  begin(): void {
    this.state.begin();
    if (this.session.activeTxn !== null) {
      throw mongoError("TransactionState", "a transaction is already active on this session");
    }
    this.session.activeTxn = this.state;
  }

  database(name: string): Database {
    return new Database(this.session, name, null);
  }

  async commit(): Promise<void> {
    if (!this.state.active) {
      throw mongoError("TransactionState", "transaction is not active");
    }
    const spec = commitTxnSpec();
    txnFields(spec, this.state.lsid, this.state.txnNumber, false, false);
    this.stampOpts(spec);
    try {
      await this.session.command("admin", spec, []);
    } finally {
      // Whatever the server said, this session's txn is over.
      this.state.end();
      this.session.activeTxn = null;
    }
  }

  async rollback(): Promise<void> {
    if (!this.state.active) {
      return;
    }
    const spec = abortTxnSpec();
    txnFields(spec, this.state.lsid, this.state.txnNumber, false, false);
    this.stampOpts(spec);
    try {
      await this.session.command("admin", spec, []);
    } catch {
      // Best-effort abort — the txn dies with the session either way.
    } finally {
      this.state.end();
      this.session.activeTxn = null;
    }
  }

  stampOpts(spec: BsonDoc): void {
    if (this.opts !== null && typeof this.opts.writeConcern !== "undefined") {
      const wc: BsonDoc = {};
      if (this.opts.writeConcern === "majority") {
        wc["w"] = { kind: "string", v: "majority" };
      } else {
        wc["w"] = { kind: "int32", v: this.opts.writeConcern.w };
        if (typeof this.opts.writeConcern.j !== "undefined") {
          wc["j"] = { kind: "boolean", v: this.opts.writeConcern.j };
        }
      }
      spec["writeConcern"] = vObj(wc);
    }
    if (this.opts !== null && typeof this.opts.readConcern !== "undefined") {
      const rc: BsonDoc = {};
      rc["level"] = { kind: "string", v: this.opts.readConcern };
      spec["readConcern"] = vObj(rc);
    }
  }

  async close(): Promise<void> {
    if (this.state.active) {
      await this.rollback();
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** Transaction.database returns a plain Database on the same session —
 * while the transaction is active the session stamps every command spec
 * with lsid/txnNumber/autocommit (first one also startTransaction). */
