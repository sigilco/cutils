// @cutils/sqlite — embedded SQLite for chttp/scriptc apps.
//
// better-sqlite3 ergonomics, narrowed to what the scriptc subset lowers:
// `prepare().get/all/run/bind()`, `exec`, `pragma`, `transaction()`,
// columns metadata, `using` via `[Symbol.dispose]()`. Row typing and
// validation flow through the Standard-Schema seam: `prepare(sql, schema)`
// returns `Stmt<InferOutput<typeof schema>>`; the `*Raw` family opts out.
//
// Subset notes: non-generic `*Core` classes + `interface X extends XCore` /
// `const X = XCore` aliases (generic CLASSES degrade to methodless shells,
// generic METHODS are fine and are what make the interface assignable);
// `| null` unions only except the documented `get()` divergence; no
// `?.`/`??`, no Map/Set, no `for...in`, no object/method shorthand.

import type {
  BindRecord,
  BindValue,
  ColumnInfo,
  InferOutput,
  OpenOpts,
  Row,
  RunResult,
  SqlValue,
} from "./types.ts";
// NOTE: value import, not `import type` — a type-only import erases the
// class's runtime lowering and any `StandardSchemaV1 | null` member then
// refuses as an unknown-typed union arm (SC2009/SC1090).
import { StandardSchemaV1 } from "./types.ts";
import { SqliteError, sqliteCodeName } from "./errors.ts";
import { validateRow } from "./validate.ts";
import { copyOut, ensure } from "./internal/buffer.ts";
import { utf8Decode } from "./internal/utf8.ts";
import { nextSavepoint } from "./internal/savepoint.ts";
import {
  ffiBegin,
  ffiBindBlob,
  ffiBindCount,
  ffiBindDbl,
  ffiBindIndex,
  ffiBindInt,
  ffiBindNull,
  ffiBindText,
  ffiChanges,
  ffiClearBindings,
  ffiClose,
  ffiColumnBlob,
  ffiColumnCount,
  ffiColumnDbl,
  ffiColumnInt64,
  ffiColumnMeta,
  ffiColumnName,
  ffiColumnText,
  ffiColumnType,
  ffiCommit,
  ffiErrcode,
  ffiErrmsg,
  ffiExec,
  ffiExpandedSql,
  ffiFinalize,
  ffiInTransaction,
  ffiLastInsertRowid,
  ffiOpen,
  ffiPrepare,
  ffiReset,
  ffiRollback,
  ffiSavepoint,
  ffiStep,
  ffiStmtReadonly,
} from "./internal/ffi.ts";

export type { BindRecord, BindValue, ColumnInfo, InferOutput, OpenOpts, Row, RunResult, SqlValue };
export { StandardSchemaV1, StdProps } from "./types.ts";
export { SqliteError };

// SQLITE_OPEN_* flags.
const OPEN_READONLY: number = 1;
const OPEN_READWRITE: number = 2;
const OPEN_CREATE: number = 4;

// sqlite3_column_type values.
const COL_INTEGER: number = 1;
const COL_FLOAT: number = 2;
const COL_TEXT: number = 3;
const COL_BLOB: number = 4;

// shim_savepoint op codes.
const SP_SAVE: number = 0;
const SP_RELEASE: number = 1;
const SP_ROLLBACK: number = 2;

const STEP_ROW: number = 0;
const STEP_DONE: number = 101;

const ERR_CLOSED: string = "database connection is not open";
const ERR_FINALIZED: string = "statement is finalized";

class StmtCore implements Disposable {
  _db: Database;
  _stmt: bigint;
  _source: string;
  _schema: StandardSchemaV1 | null;
  _reader: boolean;
  _readonly: boolean;
  _finalized: boolean;

  constructor(db: Database, stmt: bigint, source: string, schema: StandardSchemaV1 | null) {
    this._db = db;
    this._stmt = stmt;
    this._source = source;
    this._schema = schema;
    this._reader = ffiColumnCount(stmt) > 0;
    this._readonly = ffiStmtReadonly(stmt) === 1;
    this._finalized = false;
  }

  get source(): string {
    return this._source;
  }

  get reader(): boolean {
    return this._reader;
  }

  get readonly(): boolean {
    return this._readonly;
  }

  get database(): Database {
    return this._db;
  }

  get schema(): StandardSchemaV1 | null {
    return this._schema;
  }

  _checkLive(): void {
    if (this._finalized) {
      throw new SqliteError("SQLITE_MISUSE", ERR_FINALIZED);
    }
  }

  _bindValue(idx: number, v: BindValue): void {
    let rc: number;
    if (v === null) {
      rc = ffiBindNull(this._stmt, idx);
    } else if (typeof v === "bigint") {
      rc = ffiBindInt(this._stmt, idx, v);
    } else if (typeof v === "number") {
      if (Number.isInteger(v) && v <= 9007199254740991 && v >= -9007199254740991) {
        rc = ffiBindInt(this._stmt, idx, BigInt(v));
      } else {
        rc = ffiBindDbl(this._stmt, idx, v);
      }
    } else if (typeof v === "boolean") {
      rc = ffiBindInt(this._stmt, idx, v ? BigInt(1) : BigInt(0));
    } else if (typeof v === "string") {
      rc = ffiBindText(this._stmt, idx, v);
    } else if (typeof v === "undefined") {
      // Schema-validated records may carry optional keys as `undefined`
      // (valibot `optional()`); bind NULL, better-sqlite3 semantics.
      rc = ffiBindNull(this._stmt, idx);
    } else {
      rc = ffiBindBlob(this._stmt, idx, v);
    }
    if (rc !== 0) {
      this._db._throwDb(rc, "bind failed");
    }
  }

  _namedIndex(key: string): number {
    // Named params may be keyed with or without their sigil: "title",
    // ":title", "@title", "$title" all resolve against :title/@title/$title
    // in the prepared SQL.
    let idx = ffiBindIndex(this._stmt, key);
    if (idx !== 0) {
      return idx;
    }
    let bare = key;
    const c0 = key.charAt(0);
    if (c0 === ":" || c0 === "@" || c0 === "$") {
      bare = key.slice(1);
      idx = ffiBindIndex(this._stmt, bare);
      if (idx !== 0) {
        return idx;
      }
    }
    idx = ffiBindIndex(this._stmt, ":" + bare);
    if (idx !== 0) {
      return idx;
    }
    idx = ffiBindIndex(this._stmt, "@" + bare);
    if (idx !== 0) {
      return idx;
    }
    return ffiBindIndex(this._stmt, "$" + bare);
  }

  _bindParams(params: unknown): void {
    // Always reset before stepping; an omitted or EMPTY params argument
    // keeps whatever bindings are currently set (the `stmt.bind()`
    // permanent-bind path) — a subset-clean stand-in for better-sqlite3's
    // zero-argument call convention.
    ffiReset(this._stmt);
    if (typeof params === "undefined") {
      return;
    }
    if (Array.isArray(params)) {
      if (params.length === 0) {
        return;
      }
      ffiClearBindings(this._stmt);
      const count = ffiBindCount(this._stmt);
      if (params.length > count) {
        throw new SqliteError(
          "BIND_PARAM",
          "too many bind parameters: got " +
            String(params.length) +
            ", statement takes " +
            String(count),
        );
      }
      for (let i = 0; i < params.length; i++) {
        this._bindValue(i + 1, params[i] as BindValue);
      }
      return;
    }
    if (typeof params !== "object" || params === null) {
      throw new SqliteError("BIND_PARAM", "bind parameters must be a tuple or a record");
    }
    const rec = params as BindRecord;
    const keys = Object.keys(rec);
    if (keys.length === 0) {
      return;
    }
    ffiClearBindings(this._stmt);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const idx = this._namedIndex(key);
      if (idx === 0) {
        throw new SqliteError("BIND_PARAM", "no bind parameter named " + key);
      }
      this._bindValue(idx, rec[key]);
    }
  }

  _columnName(idx: number): string {
    const n = ffiColumnName(this._stmt, idx, this._db._scratch);
    if (n < 0) {
      return "";
    }
    if (n > this._db._scratch.length) {
      this._db._scratch = ensure(this._db._scratch, n);
      const m = ffiColumnName(this._stmt, idx, this._db._scratch);
      if (m < 0) {
        return "";
      }
      return utf8Decode(this._db._scratch, m);
    }
    return utf8Decode(this._db._scratch, n);
  }

  _columnMeta(idx: number, which: number): string | null {
    const n = ffiColumnMeta(this._stmt, idx, which, this._db._scratch);
    if (n < 0) {
      return null;
    }
    if (n > this._db._scratch.length) {
      this._db._scratch = ensure(this._db._scratch, n);
      const m = ffiColumnMeta(this._stmt, idx, which, this._db._scratch);
      if (m < 0) {
        return null;
      }
      return utf8Decode(this._db._scratch, m);
    }
    return utf8Decode(this._db._scratch, n);
  }

  _columnValue(idx: number): SqlValue {
    const t = ffiColumnType(this._stmt, idx);
    if (t === COL_INTEGER) {
      const b = ffiColumnInt64(this._stmt, idx);
      const n = Number(b);
      if (Number.isSafeInteger(n)) {
        return n;
      }
      return b;
    }
    if (t === COL_FLOAT) {
      return ffiColumnDbl(this._stmt, idx);
    }
    if (t === COL_TEXT) {
      const n = ffiColumnText(this._stmt, idx, this._db._scratch);
      if (n < 0) {
        return "";
      }
      if (n > this._db._scratch.length) {
        this._db._scratch = ensure(this._db._scratch, n);
        const m = ffiColumnText(this._stmt, idx, this._db._scratch);
        if (m < 0) {
          return "";
        }
        return utf8Decode(this._db._scratch, m);
      }
      return utf8Decode(this._db._scratch, n);
    }
    if (t === COL_BLOB) {
      const n = ffiColumnBlob(this._stmt, idx, this._db._scratch);
      if (n < 0) {
        return new Uint8Array(0);
      }
      if (n > this._db._scratch.length) {
        this._db._scratch = ensure(this._db._scratch, n);
        const m = ffiColumnBlob(this._stmt, idx, this._db._scratch);
        if (m < 0) {
          return new Uint8Array(0);
        }
        return copyOut(this._db._scratch, m);
      }
      return copyOut(this._db._scratch, n);
    }
    return null;
  }

  _readRow(): Row {
    const ncols = ffiColumnCount(this._stmt);
    const row: Row = {};
    for (let i = 0; i < ncols; i++) {
      row[this._columnName(i)] = this._columnValue(i);
    }
    return row;
  }

  _validateOut(row: Row): unknown {
    if (this._schema === null) {
      return row;
    }
    return validateRow(this._schema, row);
  }

  _stepOnce(): unknown {
    const rc = ffiStep(this._stmt);
    if (rc === STEP_ROW) {
      const row = this._readRow();
      ffiReset(this._stmt);
      return this._validateOut(row);
    }
    ffiReset(this._stmt);
    if (rc === STEP_DONE) {
      return null;
    }
    this._db._throwDb(rc, "step failed");
    return null;
  }

  _allRows(): unknown[] {
    const out: unknown[] = [];
    for (;;) {
      const rc = ffiStep(this._stmt);
      if (rc === STEP_ROW) {
        out.push(this._validateOut(this._readRow()));
        continue;
      }
      ffiReset(this._stmt);
      if (rc === STEP_DONE) {
        return out;
      }
      this._db._throwDb(rc, "step failed");
      return out;
    }
  }

  _drain(): void {
    for (;;) {
      const rc = ffiStep(this._stmt);
      if (rc === STEP_ROW) {
        continue;
      }
      ffiReset(this._stmt);
      if (rc === STEP_DONE) {
        return;
      }
      this._db._throwDb(rc, "step failed");
      return;
    }
  }

  _runResult(): RunResult {
    return {
      changes: ffiChanges(this._db._db),
      lastInsertRowid: Number(ffiLastInsertRowid(this._db._db)),
    };
  }

  run(params: BindValue[]): RunResult;
  run(params: BindRecord): RunResult;
  run(params: unknown): RunResult {
    this._checkLive();
    let bound = params;
    if (this._schema !== null && typeof params !== "undefined") {
      bound = validateRow(this._schema, params);
    }
    this._bindParams(bound);
    this._drain();
    return this._runResult();
  }

  runRaw(params: BindValue[]): RunResult;
  runRaw(params: BindRecord): RunResult;
  runRaw(params: unknown): RunResult {
    this._checkLive();
    this._bindParams(params);
    this._drain();
    return this._runResult();
  }

  get<TRow>(params: BindValue[]): TRow;
  get<TRow>(params: BindRecord): TRow;
  get(params: unknown): unknown {
    this._checkLive();
    this._bindParams(params);
    const row = this._stepOnce();
    if (row === null) {
      return undefined;
    }
    return row;
  }

  getOrNull<TRow>(params: BindValue[]): TRow | null;
  getOrNull<TRow>(params: BindRecord): TRow | null;
  getOrNull(params: unknown): unknown {
    this._checkLive();
    this._bindParams(params);
    return this._stepOnce();
  }

  getRaw(params: BindValue[]): unknown;
  getRaw(params: BindRecord): unknown;
  getRaw(params: unknown): unknown {
    this._checkLive();
    this._bindParams(params);
    const rc = ffiStep(this._stmt);
    if (rc === STEP_ROW) {
      const row = this._readRow();
      ffiReset(this._stmt);
      return row;
    }
    ffiReset(this._stmt);
    if (rc === STEP_DONE) {
      return null;
    }
    this._db._throwDb(rc, "step failed");
    return null;
  }

  all<TRow>(params: BindValue[]): TRow[];
  all<TRow>(params: BindRecord): TRow[];
  all(params: unknown): unknown {
    this._checkLive();
    this._bindParams(params);
    return this._allRows();
  }

  allRaw(params: BindValue[]): unknown[];
  allRaw(params: BindRecord): unknown[];
  allRaw(params: unknown): unknown[] {
    this._checkLive();
    this._bindParams(params);
    const out: unknown[] = [];
    for (;;) {
      const rc = ffiStep(this._stmt);
      if (rc === STEP_ROW) {
        out.push(this._readRow());
        continue;
      }
      ffiReset(this._stmt);
      if (rc === STEP_DONE) {
        return out;
      }
      this._db._throwDb(rc, "step failed");
      return out;
    }
  }

  bind(params: BindValue[]): StmtCore;
  bind(params: BindRecord): StmtCore;
  bind(params: unknown): StmtCore {
    this._checkLive();
    if (typeof params === "undefined") {
      return this;
    }
    if (Array.isArray(params)) {
      const count = ffiBindCount(this._stmt);
      if (params.length > count) {
        throw new SqliteError("BIND_PARAM", "too many bind parameters");
      }
      for (let i = 0; i < params.length; i++) {
        this._bindValue(i + 1, params[i] as BindValue);
      }
      return this;
    }
    if (typeof params !== "object" || params === null) {
      throw new SqliteError("BIND_PARAM", "bind parameters must be a tuple or a record");
    }
    const rec = params as BindRecord;
    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const idx = this._namedIndex(key);
      if (idx === 0) {
        throw new SqliteError("BIND_PARAM", "no bind parameter named " + key);
      }
      this._bindValue(idx, rec[key]);
    }
    return this;
  }

  columns(): ColumnInfo[] {
    this._checkLive();
    const ncols = ffiColumnCount(this._stmt);
    const out: ColumnInfo[] = [];
    for (let i = 0; i < ncols; i++) {
      out.push({
        name: this._columnName(i),
        column: this._columnMeta(i, 0),
        table: this._columnMeta(i, 1),
        database: this._columnMeta(i, 2),
        type: this._columnMeta(i, 3),
      });
    }
    return out;
  }

  toString(): string {
    const n = ffiExpandedSql(this._stmt, this._db._scratch);
    if (n < 0) {
      return this._source;
    }
    if (n > this._db._scratch.length) {
      this._db._scratch = ensure(this._db._scratch, n);
      const m = ffiExpandedSql(this._stmt, this._db._scratch);
      if (m < 0) {
        return this._source;
      }
      return utf8Decode(this._db._scratch, m);
    }
    return utf8Decode(this._db._scratch, n);
  }

  finalize(): void {
    if (this._finalized) {
      return;
    }
    this._finalized = true;
    ffiFinalize(this._stmt);
    this._db._untrack(this);
  }

  [Symbol.dispose](): void {
    this.finalize();
  }
}

/**
 * `Stmt<TRow>` — a prepared statement. `TRow` is the schema's
 * `InferOutput` when prepared via `prepare(sql, schema)`, else `unknown`.
 * The runtime class is `StmtCore`; this interface supplies the `TRow`-typed
 * method surface (generic classes do not survive scriptc 0.3.x).
 */
export interface Stmt<TRow = unknown> extends StmtCore {
  readonly source: string;
  readonly reader: boolean;
  readonly readonly: boolean;
  readonly database: Database;
  readonly schema: StandardSchemaV1 | null;
  run(params: BindValue[]): RunResult;
  run(params: BindRecord): RunResult;
  runRaw(params: BindValue[]): RunResult;
  runRaw(params: BindRecord): RunResult;
  get(params: BindValue[]): TRow | undefined;
  get(params: BindRecord): TRow | undefined;
  getOrNull(params: BindValue[]): TRow | null;
  getOrNull(params: BindRecord): TRow | null;
  getRaw(params: BindValue[]): unknown;
  getRaw(params: BindRecord): unknown;
  all(params: BindValue[]): TRow[];
  all(params: BindRecord): TRow[];
  allRaw(params: BindValue[]): unknown[];
  allRaw(params: BindRecord): unknown[];
  bind(params: BindValue[]): this;
  bind(params: BindRecord): this;
}

export const Stmt = StmtCore;

// Live statements and open transactions per Database — kept in a
// module-level registry, NOT on the class: a `StmtCore[]`/`Transaction[]`
// field is a class-array member and refuses when the Database shape
// crosses the npm-package boundary (SC2009), exactly like the old
// `Scratch` field did across internal modules.
interface DbTrack {
  db: Database;
  stmts: StmtCore[];
  txs: Transaction[];
}
const DB_TRACK: DbTrack[] = [];

function trackOf(db: Database): DbTrack {
  for (let i = 0; i < DB_TRACK.length; i++) {
    if (DB_TRACK[i].db === db) {
      return DB_TRACK[i];
    }
  }
  const t: DbTrack = { db: db, stmts: [], txs: [] };
  DB_TRACK.push(t);
  return t;
}

function dropTrack(db: Database): void {
  for (let i = 0; i < DB_TRACK.length; i++) {
    if (DB_TRACK[i].db === db) {
      DB_TRACK.splice(i, 1);
      return;
    }
  }
}

export class Database implements Disposable {
  _db: bigint;
  _path: string;
  _memory: boolean;
  _readonly: boolean;
  _closed: boolean;
  _scratch: Uint8Array;

  constructor(handle: bigint, path: string, memory: boolean, readonly_: boolean) {
    this._db = handle;
    this._path = path;
    this._memory = memory;
    this._readonly = readonly_;
    this._closed = false;
    this._scratch = new Uint8Array(4096);
  }

  static open(path: string, opts?: OpenOpts): Database {
    let flags = OPEN_READWRITE;
    let ro = false;
    let mustExist = false;
    if (typeof opts !== "undefined") {
      if (opts.readonly === true) {
        ro = true;
      }
      if (opts.fileMustExist === true) {
        mustExist = true;
      }
    }
    if (ro) {
      flags = OPEN_READONLY;
    } else {
      flags = OPEN_READWRITE;
      if (!mustExist) {
        flags = OPEN_READWRITE | OPEN_CREATE;
      }
    }
    const h = ffiOpen(path, flags);
    if (Number(h) === 0) {
      throw new SqliteError("SQLITE_NOMEM", "out of memory opening " + path);
    }
    const rc = ffiErrcode(h);
    if (rc !== 0) {
      const scratch = new Uint8Array(4096);
      const n = ffiErrmsg(h, scratch);
      const msg = n >= 0 ? utf8Decode(scratch, n) : "open failed";
      ffiClose(h);
      throw new SqliteError(sqliteCodeName(rc), msg);
    }
    return new Database(h, path, path === ":memory:", ro);
  }

  static openInMemory(): Database {
    const db = Database.open(":memory:");
    db._memory = true;
    return db;
  }

  get path(): string {
    return this._path;
  }

  get memory(): boolean {
    return this._memory;
  }

  get readonly(): boolean {
    return this._readonly;
  }

  get inTransaction(): boolean {
    if (this._closed) {
      return false;
    }
    return ffiInTransaction(this._db) === 1;
  }

  _checkOpen(): void {
    if (this._closed) {
      throw new SqliteError("SQLITE_MISUSE", ERR_CLOSED);
    }
  }

  _errmsg(): string {
    const n = ffiErrmsg(this._db, this._scratch);
    if (n < 0) {
      return "sqlite error";
    }
    if (n > this._scratch.length) {
      this._scratch = ensure(this._scratch, n);
      const m = ffiErrmsg(this._db, this._scratch);
      if (m < 0) {
        return "sqlite error";
      }
      return utf8Decode(this._scratch, m);
    }
    return utf8Decode(this._scratch, n);
  }

  _throwDb(rc: number, fallback: string): never {
    let msg = this._errmsg();
    if (msg.length === 0) {
      msg = fallback;
    }
    const txs = trackOf(this).txs;
    if (txs.length > 0) {
      txs[txs.length - 1]._failed = true;
    }
    // Prefer the handle's EXTENDED errcode: call-site rcs are the primary
    // code, so SQLITE_CONSTRAINT_UNIQUE/NOTNULL/... would be lost.
    const ext = ffiErrcode(this._db);
    throw new SqliteError(sqliteCodeName(ext !== 0 ? ext : rc), msg);
  }

  _untrack(stmt: StmtCore): void {
    const arr = trackOf(this).stmts;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === stmt) {
        arr.splice(i, 1);
        return;
      }
    }
  }

  _prepareCore(sql: string, schema: StandardSchemaV1 | null): StmtCore {
    this._checkOpen();
    const st = ffiPrepare(this._db, sql);
    if (Number(st) === 0) {
      this._throwDb(ffiErrcode(this._db), "prepare failed");
    }
    const stmt = new StmtCore(this, st, sql, schema);
    trackOf(this).stmts.push(stmt);
    return stmt;
  }

  exec(sql: string): void {
    this._checkOpen();
    const rc = ffiExec(this._db, sql);
    if (rc !== 0) {
      this._throwDb(rc, "exec failed");
    }
  }

  execRaw(sql: string): void {
    this.exec(sql);
  }

  pragma(sql: string): { rows: Row[] } {
    const stmt = this._prepareCore("PRAGMA " + sql, null);
    const rows = stmt.allRaw([]);
    stmt.finalize();
    const out: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      out.push(rows[i] as Row);
    }
    return { rows: out };
  }

  transaction(): Transaction {
    this._checkOpen();
    if (this.inTransaction) {
      const name = nextSavepoint();
      const rc = ffiSavepoint(this._db, name, SP_SAVE);
      if (rc !== 0) {
        this._throwDb(rc, "savepoint failed");
      }
      const txs = trackOf(this).txs;
      const parent = txs.length > 0 ? txs[txs.length - 1] : null;
      const tx = new Transaction(this, parent, name);
      txs.push(tx);
      return tx;
    }
    const rc = ffiBegin(this._db);
    if (rc !== 0) {
      this._throwDb(rc, "begin failed");
    }
    const tx = new Transaction(this, null, null);
    trackOf(this).txs.push(tx);
    return tx;
  }

  prepare<Schema extends StandardSchemaV1>(sql: string, schema: Schema): Stmt<InferOutput<Schema>> {
    return this._prepareCore(sql, schema);
  }

  prepareRaw(sql: string): Stmt<unknown> {
    return this._prepareCore(sql, null);
  }

  lastInsertRowid(): number {
    this._checkOpen();
    return Number(ffiLastInsertRowid(this._db));
  }

  changes(): number {
    this._checkOpen();
    return ffiChanges(this._db);
  }

  close(): void {
    if (this._closed) {
      return;
    }
    const stmts = trackOf(this).stmts;
    for (let i = stmts.length - 1; i >= 0; i--) {
      stmts[i].finalize();
    }
    this._closed = true;
    ffiClose(this._db);
    dropTrack(this);
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

export class Transaction implements Disposable {
  _db: Database;
  _parent: Transaction | null;
  _savepoint: string | null;
  _done: boolean;
  _failed: boolean;

  constructor(db: Database, parent: Transaction | null, savepoint: string | null) {
    this._db = db;
    this._parent = parent;
    this._savepoint = savepoint;
    this._done = false;
    this._failed = false;
  }

  get database(): Database {
    return this._db;
  }

  _checkLive(): void {
    if (this._done) {
      throw new SqliteError("SQLITE_MISUSE", "transaction is already finished");
    }
  }

  _popSelf(): void {
    const txs = trackOf(this._db).txs;
    for (let i = txs.length - 1; i >= 0; i--) {
      if (txs[i] === this) {
        txs.splice(i, 1);
        return;
      }
    }
  }

  exec(sql: string): void {
    this._checkLive();
    this._db.exec(sql);
  }

  execRaw(sql: string): void {
    this.exec(sql);
  }

  prepare<Schema extends StandardSchemaV1>(sql: string, schema: Schema): Stmt<InferOutput<Schema>> {
    this._checkLive();
    return this._db._prepareCore(sql, schema);
  }

  prepareRaw(sql: string): Stmt<unknown> {
    this._checkLive();
    return this._db._prepareCore(sql, null);
  }

  savepoint(name: string): Transaction {
    this._checkLive();
    const rc = ffiSavepoint(this._db._db, name, SP_SAVE);
    if (rc !== 0) {
      this._db._throwDb(rc, "savepoint failed");
    }
    const tx = new Transaction(this._db, this, name);
    trackOf(this._db).txs.push(tx);
    return tx;
  }

  commit(): void {
    this._checkLive();
    if (this._savepoint !== null) {
      const rc = ffiSavepoint(this._db._db, this._savepoint, SP_RELEASE);
      if (rc !== 0) {
        this._db._throwDb(rc, "release savepoint failed");
      }
    } else {
      const rc = ffiCommit(this._db._db);
      if (rc !== 0) {
        this._db._throwDb(rc, "commit failed");
      }
    }
    this._done = true;
    this._popSelf();
  }

  rollback(): void {
    this._checkLive();
    if (this._savepoint !== null) {
      const rc = ffiSavepoint(this._db._db, this._savepoint, SP_ROLLBACK);
      if (rc !== 0) {
        this._db._throwDb(rc, "rollback to savepoint failed");
      }
    } else {
      const rc = ffiRollback(this._db._db);
      if (rc !== 0) {
        this._db._throwDb(rc, "rollback failed");
      }
    }
    this._done = true;
    this._popSelf();
  }

  [Symbol.dispose](): void {
    if (this._done) {
      return;
    }
    // A SqliteError thrown inside the transaction marks `_failed`;
    // dispose can't see user-level throws, so clean exits commit and
    // error exits roll back — documented in docs/subset-quirks.md.
    if (this._failed) {
      this.rollback();
      return;
    }
    this.commit();
  }
}
