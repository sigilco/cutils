// @cutils/postgres — hand-rolled async Postgres wire-protocol driver for
// chttp/scriptc apps: `node:net` + `node:crypto` + subset TypeScript, no
// FFI, no `pg`.
//
// Same public skeleton as @cutils/sqlite, async: `connect()`,
// `prepare(sql, schema).run/get/getOrNull/all/bind()`, `exec`,
// `transaction()`, `await using` via `[Symbol.asyncDispose]()`. Row typing
// and validation flow through the Standard-Schema seam: `prepare(sql,
// schema)` returns `Stmt<InferOutput<typeof schema>>`; the `*Raw` family
// opts out. Postgres add-ons: `execute`, `notify`, `cancel`,
// `serverVersion`, `backendPid`/`backendSecret`.
//
// Subset notes: non-generic `*Core` classes + `interface X extends XCore` /
// `const X = XCore` aliases; `| null` unions only except the documented
// `get()` divergence; no `?.`/`??`, no `for...in`, no object/method
// shorthand.

import { PgError, pgError } from "./errors.ts";
import type {
  BindRecord,
  BindValue,
  ColumnInfo,
  ConnectOpts,
  InferOutput,
  NotifyEvent,
  Row,
  RunResult,
  SqlValue,
} from "./types.ts";
// NOTE: value import, not `import type` — a type-only import erases the
// class's runtime lowering and any `StandardSchemaV1 | null` member then
// refuses as an unknown-typed union arm (SC2009/SC1090).
import { StandardSchemaV1 } from "./types.ts";
import { validateRow } from "./validate.ts";
import { authenticate } from "./internal/auth.ts";
import {
  B_ERROR,
  decodeErrorFields,
  encStartup,
  encTerminate,
  scanParams,
} from "./internal/messages.ts";
import { notifySql } from "./internal/notify.ts";
import { sendCancel } from "./internal/cancel.ts";
import { simpleQuery } from "./internal/simple.ts";
import { closeStatement, executeOn, prepareOn, queryUnnamed } from "./internal/extended.ts";
import type { ExecResult } from "./internal/extended.ts";
import { encodeText, rowFromValues } from "./internal/rows.ts";
import type { ColDesc } from "./internal/rows.ts";
import { oidName } from "./internal/oids.ts";
import { Exchange, PgSocket } from "./internal/socket.ts";
import { assertSslSupported } from "./internal/tls.ts";

export type {
  BindRecord,
  BindValue,
  ColumnInfo,
  ConnectOpts,
  InferOutput,
  NotifyEvent,
  Row,
  RunResult,
  SqlValue,
};
export { StandardSchemaV1, StdProps } from "./types.ts";
export { PgError };

const ERR_CLOSED: string = "database connection is not open";
const ERR_FINALIZED: string = "statement is finalized";

let stmtSeq: number = 0;
function nextStmtName(): string {
  stmtSeq = stmtSeq + 1;
  return "cutils_pg_" + String(stmtSeq);
}

let spSeq: number = 0;
function nextSavepoint(): string {
  spSeq = spSeq + 1;
  return "cutils_sp_" + String(spSeq);
}

interface BindPack {
  texts: string[];
  nulls: boolean[];
}

interface CatalogRow {
  attnum: number;
  attname: string;
  attnotnull: boolean;
  defexpr: string | null;
  relname: string;
  nspname: string;
}

function firstWord(sql: string): string {
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 40) {
      i = i + 1;
      continue;
    }
    break;
  }
  let e = i;
  while (e < n) {
    const c = sql.charCodeAt(e);
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
      e = e + 1;
      continue;
    }
    break;
  }
  return sql.slice(i, e).toLowerCase();
}

function isReadonlySql(sql: string): boolean {
  const w = firstWord(sql);
  return (
    w === "select" ||
    w === "with" ||
    w === "show" ||
    w === "explain" ||
    w === "table" ||
    w === "values"
  );
}

class StmtCore implements AsyncDisposable {
  _db: Database;
  _name: string;
  _source: string;
  _sql: string;
  _paramNames: string[];
  _cols: ColDesc[];
  _catalog: CatalogRow[];
  _paramCount: number;
  _schema: StandardSchemaV1 | null;
  _reader: boolean;
  _readonly: boolean;
  _finalized: boolean;
  _bound: BindPack | null;

  /**
   * @param {Database} db
   * @param {string} name
   * @param {string} source
   * @param {string} sql
   * @param {string[]} paramNames
   * @param {Array<{name: string, tableOid: number, attrNum: number, typeOid: number, typeSize: number, typeModifier: number, format: number}>} cols
   * @param {number} paramCount
   * @param {unknown} schema
   */
  constructor(
    db: Database,
    name: string,
    source: string,
    sql: string,
    paramNames: string[],
    cols: ColDesc[],
    paramCount: number,
    schema: StandardSchemaV1 | null,
  ) {
    this._db = db;
    this._name = name;
    this._source = source;
    this._sql = sql;
    this._paramNames = paramNames;
    this._cols = cols;
    this._catalog = [];
    this._paramCount = paramCount;
    this._schema = schema;
    this._reader = cols.length > 0;
    this._readonly = isReadonlySql(sql);
    this._finalized = false;
    this._bound = null;
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
      throw new PgError({
        code: "MISUSE",
        message: ERR_FINALIZED,
        severity: "ERROR",
        detail: null,
        hint: null,
        position: null,
      });
    }
  }

  _encodeParams(params: unknown): BindPack {
    const texts: string[] = [];
    const nulls: boolean[] = [];
    if (typeof params === "undefined" || params === null) {
      if (this._bound !== null) {
        return this._bound;
      }
      return { texts: texts, nulls: nulls };
    }
    if (Array.isArray(params)) {
      // The JS emit keeps this cast: Array.isArray narrows to any[], which
      // scriptc's --npm-static JS inference cannot lower — unknown[] can.
      const arr = /** @type {unknown[]} */ (params);
      if (arr.length === 0) {
        return { texts: texts, nulls: nulls };
      }
      if (arr.length > this._paramCount) {
        throw pgError(
          "BIND_PARAM",
          "too many bind parameters: got " +
            String(arr.length) +
            ", statement takes " +
            String(this._paramCount),
        );
      }
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v === null || typeof v === "undefined") {
          texts.push("");
          nulls.push(true);
        } else {
          texts.push(encodeText(v));
          nulls.push(false);
        }
      }
      return { texts: texts, nulls: nulls };
    }
    if (typeof params !== "object") {
      throw pgError("BIND_PARAM", "bind parameters must be a tuple or a record");
    }
    const rec = params as BindRecord;
    const keys = Object.keys(rec);
    if (keys.length === 0) {
      return { texts: texts, nulls: nulls };
    }
    for (let i = 0; i < this._paramNames.length; i++) {
      const name = this._paramNames[i];
      if (name === "") {
        // anonymous $N slot in mixed SQL — not satisfiable by record binds
        texts.push("");
        nulls.push(true);
        continue;
      }
      let v: unknown = rec[name];
      if (typeof v === "undefined") {
        v = rec[":" + name];
      }
      if (typeof v === "undefined") {
        v = rec["@" + name];
      }
      if (typeof v === "undefined") {
        v = rec["$" + name];
      }
      if (typeof v === "undefined") {
        throw pgError("BIND_PARAM", "no bind parameter named " + name);
      }
      if (v === null) {
        texts.push("");
        nulls.push(true);
      } else {
        texts.push(encodeText(v as SqlValue));
        nulls.push(false);
      }
    }
    return { texts: texts, nulls: nulls };
  }

  async _wireExecute(texts: string[], nulls: boolean[], maxRows: number): Promise<ExecResult> {
    try {
      return await executeOn(this._db._sock, this._name, texts, nulls, this._cols, maxRows);
    } catch (e) {
      this._db._txFailed();
      throw e;
    }
  }

  async _rowsOf(texts: string[], nulls: boolean[], maxRows: number): Promise<Row[]> {
    const res = await this._wireExecute(texts, nulls, maxRows);
    const out: Row[] = [];
    for (let i = 0; i < res.rows.length; i++) {
      out.push(rowFromValues(this._cols, res.rows[i]));
    }
    return out;
  }

  async _validateOut(row: Row): Promise<unknown> {
    if (this._schema === null) {
      return row;
    }
    return validateRow(this._schema, row);
  }

  async _validatedRows(texts: string[], nulls: boolean[]): Promise<unknown[]> {
    const rows = await this._rowsOf(texts, nulls, 0);
    const out: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      out.push(await this._validateOut(rows[i]));
    }
    return out;
  }

  run(params: BindValue[]): Promise<RunResult>;
  run(params: BindRecord): Promise<RunResult>;
  async run(params: unknown): Promise<RunResult> {
    this._checkLive();
    let bound = params;
    if (this._schema !== null && typeof params !== "undefined") {
      bound = await validateRow(this._schema, params);
    }
    const pack = this._encodeParams(bound);
    const res = await this._wireExecute(pack.texts, pack.nulls, 0);
    return { rowCount: res.rowCount };
  }

  runRaw(params: BindValue[]): Promise<RunResult>;
  runRaw(params: BindRecord): Promise<RunResult>;
  async runRaw(params: unknown): Promise<RunResult> {
    this._checkLive();
    const pack = this._encodeParams(params);
    const res = await this._wireExecute(pack.texts, pack.nulls, 0);
    return { rowCount: res.rowCount };
  }

  get<TRow>(params: BindValue[]): Promise<TRow>;
  get<TRow>(params: BindRecord): Promise<TRow>;
  async get(params: unknown): Promise<unknown> {
    this._checkLive();
    const pack = this._encodeParams(params);
    const rows = await this._validatedRows(pack.texts, pack.nulls);
    if (rows.length === 0) {
      return undefined;
    }
    return rows[0];
  }

  getOrNull<TRow>(params: BindValue[]): Promise<TRow | null>;
  getOrNull<TRow>(params: BindRecord): Promise<TRow | null>;
  async getOrNull(params: unknown): Promise<unknown> {
    this._checkLive();
    const pack = this._encodeParams(params);
    const rows = await this._validatedRows(pack.texts, pack.nulls);
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  }

  getRaw(params: BindValue[]): Promise<unknown>;
  getRaw(params: BindRecord): Promise<unknown>;
  async getRaw(params: unknown): Promise<unknown> {
    this._checkLive();
    const pack = this._encodeParams(params);
    const rows = await this._rowsOf(pack.texts, pack.nulls, 0);
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  }

  all<TRow>(params: BindValue[]): Promise<TRow[]>;
  all<TRow>(params: BindRecord): Promise<TRow[]>;
  async all(params: unknown): Promise<unknown> {
    this._checkLive();
    const pack = this._encodeParams(params);
    return this._validatedRows(pack.texts, pack.nulls);
  }

  allRaw(params: BindValue[]): Promise<unknown[]>;
  allRaw(params: BindRecord): Promise<unknown[]>;
  async allRaw(params: unknown): Promise<unknown[]> {
    this._checkLive();
    const pack = this._encodeParams(params);
    const rows = await this._rowsOf(pack.texts, pack.nulls, 0);
    const out: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      out.push(rows[i]);
    }
    return out;
  }

  bind(params: BindValue[]): StmtCore;
  bind(params: BindRecord): StmtCore;
  bind(params: unknown): StmtCore {
    this._checkLive();
    this._bound = this._encodeParams(params);
    return this;
  }

  _catalogFor(col: ColDesc): CatalogRow | null {
    for (let i = 0; i < this._catalog.length; i++) {
      const r = this._catalog[i];
      if (r.attnum === col.attrNum && r.relname.length > 0) {
        return r;
      }
    }
    return null;
  }

  columns(): ColumnInfo[] {
    this._checkLive();
    const out: ColumnInfo[] = [];
    for (let i = 0; i < this._cols.length; i++) {
      const c = this._cols[i];
      const cat = this._catalogFor(c);
      out.push({
        name: c.name,
        column: cat !== null ? cat.attname : null,
        table: cat !== null ? cat.relname : null,
        schema: cat !== null ? cat.nspname : null,
        database: this._db.database,
        type: oidName(c.typeOid),
        notNull: cat !== null ? cat.attnotnull : false,
        default: cat !== null ? cat.defexpr : null,
      });
    }
    return out;
  }

  toString(): string {
    return this._source;
  }

  async finalize(): Promise<void> {
    if (this._finalized) {
      return;
    }
    this._finalized = true;
    this._db._untrack(this);
    if (!this._db._sock.closed) {
      await closeStatement(this._db._sock, this._name);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.finalize();
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
  run(params: BindValue[]): Promise<RunResult>;
  run(params: BindRecord): Promise<RunResult>;
  runRaw(params: BindValue[]): Promise<RunResult>;
  runRaw(params: BindRecord): Promise<RunResult>;
  get(params: BindValue[]): Promise<TRow | undefined>;
  get(params: BindRecord): Promise<TRow | undefined>;
  getOrNull(params: BindValue[]): Promise<TRow | null>;
  getOrNull(params: BindRecord): Promise<TRow | null>;
  getRaw(params: BindValue[]): Promise<unknown>;
  getRaw(params: BindRecord): Promise<unknown>;
  all(params: BindValue[]): Promise<TRow[]>;
  all(params: BindRecord): Promise<TRow[]>;
  allRaw(params: BindValue[]): Promise<unknown[]>;
  allRaw(params: BindRecord): Promise<unknown[]>;
  bind(params: BindValue[]): this;
  bind(params: BindRecord): this;
}

export const Stmt = StmtCore;

export class Database implements AsyncDisposable {
  _sock: PgSocket;
  _host: string;
  _port: number;
  _database: string;
  _user: string;
  _connectTimeoutMs: number;
  _closed: boolean;
  _stmts: StmtCore[];
  _txs: Transaction[];

  /**
   * @param {import("./internal/socket.js").PgSocket} sock
   * @param {string} host
   * @param {number} port
   * @param {string} database
   * @param {string} user
   * @param {number} connectTimeoutMs
   */
  constructor(
    sock: PgSocket,
    host: string,
    port: number,
    database: string,
    user: string,
    connectTimeoutMs: number,
  ) {
    this._sock = sock;
    this._host = host;
    this._port = port;
    this._database = database;
    this._user = user;
    this._connectTimeoutMs = connectTimeoutMs;
    this._closed = false;
    this._stmts = [];
    this._txs = [];
  }

  /**
   * @param {{host: string, port?: number, user: string, password: string, database: string, ssl?: string, applicationName?: string, connectTimeoutMs?: number, statementTimeoutMs?: number}} opts
   */
  static async connect(opts: ConnectOpts): Promise<Database> {
    let port = 5432;
    if (typeof opts.port === "number") {
      port = opts.port;
    }
    let ssl = "disable";
    if (typeof opts.ssl === "string") {
      ssl = opts.ssl;
    }
    assertSslSupported(ssl);
    let timeoutMs = 10000;
    if (typeof opts.connectTimeoutMs === "number") {
      timeoutMs = opts.connectTimeoutMs;
    }
    const sock = await PgSocket.connect(opts.host, port, timeoutMs);
    const db = new Database(sock, opts.host, port, opts.database, opts.user, timeoutMs);
    const params: Record<string, string> = {
      user: opts.user,
      database: opts.database,
      client_encoding: "UTF8",
    };
    if (typeof opts.applicationName === "string") {
      params.application_name = opts.applicationName;
    }
    try {
      await sock.run(async (ex: Exchange) => {
        sock.send(encStartup(params));
        await authenticate(
          ex,
          (b: Uint8Array) => {
            sock.send(b);
          },
          opts.user,
          opts.password,
        );
        // Auth done — drain until ReadyForQuery; a late ErrorResponse
        // (e.g. database does not exist) still lands as a PgError.
        let err: PgError | null = null;
        for (;;) {
          const m = await ex.next();
          if (m === null) {
            break;
          }
          if (m.type === B_ERROR) {
            err = new PgError(decodeErrorFields(m));
            continue;
          }
        }
        if (err !== null) {
          throw err;
        }
      });
    } catch (e) {
      sock.close();
      throw e;
    }
    if (typeof opts.statementTimeoutMs === "number" && opts.statementTimeoutMs > 0) {
      await db.execute("SET statement_timeout = " + String(opts.statementTimeoutMs));
    }
    return db;
  }

  get host(): string {
    return this._host;
  }

  get port(): number {
    return this._port;
  }

  get database(): string {
    return this._database;
  }

  get user(): string {
    return this._user;
  }

  get backendPid(): number {
    const k = this._sock.backendKey;
    if (k === null) {
      return 0;
    }
    return k.pid;
  }

  get backendSecret(): number {
    const k = this._sock.backendKey;
    if (k === null) {
      return 0;
    }
    return k.secret;
  }

  /** Last server_version ParameterStatus, "" when the server never sent one. */
  get serverVersion(): string {
    const v = this._sock.param("server_version");
    if (v === null) {
      return "";
    }
    return v;
  }

  get inTransaction(): boolean {
    if (this._closed) {
      return false;
    }
    const s = this._sock.txStatus;
    return s === "T" || s === "E";
  }

  _checkOpen(): void {
    if (this._closed) {
      throw new PgError({
        code: "MISUSE",
        message: ERR_CLOSED,
        severity: "ERROR",
        detail: null,
        hint: null,
        position: null,
      });
    }
  }

  /** Any wire error inside an open transaction marks it failed, so the
   * `await using` dispose rolls back — same semantic as @cutils/sqlite. */
  _txFailed(): void {
    const txs = this._txs;
    if (txs.length > 0) {
      txs[txs.length - 1]._failed = true;
    }
  }

  _untrack(stmt: StmtCore): void {
    const arr = this._stmts;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === stmt) {
        arr.splice(i, 1);
        return;
      }
    }
  }

  async _loadCatalog(stmt: StmtCore): Promise<void> {
    // One catalog query per distinct table OID in the RowDescription;
    // failures degrade to null metadata instead of failing prepare().
    const seen: number[] = [];
    for (let i = 0; i < stmt._cols.length; i++) {
      const c = stmt._cols[i];
      if (c.tableOid === 0 || c.attrNum <= 0) {
        continue;
      }
      let dup = false;
      for (let k = 0; k < seen.length; k++) {
        if (seen[k] === c.tableOid) {
          dup = true;
        }
      }
      if (dup) {
        continue;
      }
      seen.push(c.tableOid);
    }
    if (seen.length === 0) {
      return;
    }
    for (let i = 0; i < seen.length; i++) {
      const oid = seen[i];
      const res = await simpleQuery(
        this._sock,
        "SELECT a.attnum, a.attname, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS defexpr, c.relname, n.nspname" +
          " FROM pg_attribute a" +
          " JOIN pg_class c ON c.oid = a.attrelid" +
          " JOIN pg_namespace n ON n.oid = c.relnamespace" +
          " LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum" +
          " WHERE a.attrelid = " +
          String(oid),
      );
      for (let r = 0; r < res.rows.length; r++) {
        const row = res.rows[r];
        // typeof-narrow before use: `String(union-with-object-arm)` has no
        // lowering (SC1090) and the catalog only emits text columns anyway.
        stmt._catalog.push({
          attnum: typeof row.attnum === "number" ? row.attnum : 0,
          attname: typeof row.attname === "string" ? row.attname : "",
          attnotnull: row.attnotnull === true || row.attnotnull === "t",
          defexpr: typeof row.defexpr === "string" ? row.defexpr : null,
          relname: typeof row.relname === "string" ? row.relname : "",
          nspname: typeof row.nspname === "string" ? row.nspname : "",
        });
      }
    }
  }

  async _prepareCore(sql: string, schema: StandardSchemaV1 | null): Promise<StmtCore> {
    this._checkOpen();
    const scanned = scanParams(sql);
    const name = nextStmtName();
    const meta = await prepareOn(this._sock, name, scanned.sql);
    const stmt = new StmtCore(
      this,
      name,
      sql,
      scanned.sql,
      scanned.names,
      meta.cols,
      meta.paramCount,
      schema,
    );
    try {
      await this._loadCatalog(stmt);
    } catch {
      // catalog metadata is best-effort
    }
    this._stmts.push(stmt);
    return stmt;
  }

  async exec(sql: string): Promise<void> {
    this._checkOpen();
    try {
      await simpleQuery(this._sock, sql);
    } catch (e) {
      this._txFailed();
      throw e;
    }
  }

  async execRaw(sql: string): Promise<void> {
    await this.exec(sql);
  }

  /**
   * No-statement-cache shortcut for one-off queries. With `args` it uses
   * the unnamed extended path (parameters still bind safely); without it
   * uses the simple-query protocol (BEGIN/SET/SHOW/LISTEN/...).
   */
  async execute(sql: string, args?: BindValue[]): Promise<RunResult> {
    this._checkOpen();
    try {
      if (typeof args === "undefined" || args.length === 0) {
        const res = await simpleQuery(this._sock, sql);
        return { rowCount: res.rowCount };
      }
      const scanned = scanParams(sql);
      const texts: string[] = [];
      const nulls: boolean[] = [];
      for (let i = 0; i < args.length; i++) {
        const v = args[i];
        if (v === null) {
          texts.push("");
          nulls.push(true);
        } else {
          texts.push(encodeText(v));
          nulls.push(false);
        }
      }
      const res = await queryUnnamed(this._sock, scanned.sql, texts, nulls);
      return { rowCount: res.rowCount };
    } catch (e) {
      this._txFailed();
      throw e;
    }
  }

  /**
   * SHOW / SET / RESET escape hatch — runs `sql` verbatim through the
   * simple-query protocol and returns the rows (`SHOW x` yields one row).
   */
  async pragma(sql: string): Promise<{ rows: Row[] }> {
    this._checkOpen();
    let res;
    try {
      res = await simpleQuery(this._sock, sql);
    } catch (e) {
      this._txFailed();
      throw e;
    }
    return { rows: res.rows };
  }

  async transaction(): Promise<Transaction> {
    this._checkOpen();
    if (this.inTransaction) {
      const name = nextSavepoint();
      await simpleQuery(this._sock, "SAVEPOINT " + name);
      const parent = this._txs.length > 0 ? this._txs[this._txs.length - 1] : null;
      const tx = new Transaction(this, parent, name);
      this._txs.push(tx);
      return tx;
    }
    await simpleQuery(this._sock, "BEGIN");
    const tx = new Transaction(this, null, null);
    this._txs.push(tx);
    return tx;
  }

  prepare<Schema extends StandardSchemaV1>(
    sql: string,
    schema: Schema,
  ): Promise<Stmt<InferOutput<Schema>>> {
    return this._prepareCore(sql, schema);
  }

  prepareRaw(sql: string): Promise<Stmt<unknown>> {
    return this._prepareCore(sql, null);
  }

  /**
   * `NOTIFY channel, 'payload'` and drain any queued notifications
   * (including the one just sent when the connection LISTENed).
   */
  async notify(channel: string, payload: string): Promise<{ received: NotifyEvent[] }> {
    this._checkOpen();
    await simpleQuery(this._sock, notifySql(channel, payload));
    const drained = this._sock.drainNotify();
    const received: NotifyEvent[] = [];
    for (let i = 0; i < drained.length; i++) {
      received.push({
        channel: drained[i].channel,
        payload: drained[i].payload,
        pid: drained[i].pid,
      });
    }
    return { received: received };
  }

  /**
   * Cancel the in-flight query on `stmt`'s connection via a wire
   * CancelRequest on a fresh socket. Long-running `pg_sleep`-style work
   * aborts server-side; the connection survives.
   */
  async cancel(stmt: Stmt<unknown>): Promise<void> {
    this._checkOpen();
    const target = stmt.database;
    const k = target._sock.backendKey;
    if (k === null) {
      throw pgError("CONNECTION", "no backend key for cancel request");
    }
    await sendCancel(target._host, target._port, k.pid, k.secret, this._connectTimeoutMs);
  }

  /** Postgres has no rowid — always throws. */
  lastInsertRowid(): Promise<bigint> {
    return Promise.reject(pgError("0A000", "not supported: Postgres has no rowid"));
  }

  /** Postgres reports affected rows per statement — always throws. */
  changes(): Promise<number> {
    return Promise.reject(pgError("0A000", "not supported: use RunResult.rowCount"));
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    const stmts = this._stmts;
    for (let i = 0; i < stmts.length; i++) {
      stmts[i]._finalized = true;
    }
    this._stmts = [];
    try {
      this._sock.send(encTerminate());
    } catch {
      // socket already gone
    }
    this._sock.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export class Transaction implements AsyncDisposable {
  _db: Database;
  _parent: Transaction | null;
  _savepoint: string | null;
  _done: boolean;
  _failed: boolean;

  /** @param {Database} db @param {Transaction | null} parent @param {string | null} savepoint */
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
      throw new PgError({
        code: "MISUSE",
        message: "transaction is already finished",
        severity: "ERROR",
        detail: null,
        hint: null,
        position: null,
      });
    }
  }

  _popSelf(): void {
    const txs = this._db._txs;
    for (let i = txs.length - 1; i >= 0; i--) {
      if (txs[i] === this) {
        txs.splice(i, 1);
        return;
      }
    }
  }

  async exec(sql: string): Promise<void> {
    this._checkLive();
    try {
      await this._db.exec(sql);
    } catch (e) {
      this._failed = true;
      throw e;
    }
  }

  async execRaw(sql: string): Promise<void> {
    await this.exec(sql);
  }

  prepare<Schema extends StandardSchemaV1>(
    sql: string,
    schema: Schema,
  ): Promise<Stmt<InferOutput<Schema>>> {
    this._checkLive();
    return this._db._prepareCore(sql, schema);
  }

  prepareRaw(sql: string): Promise<Stmt<unknown>> {
    this._checkLive();
    return this._db._prepareCore(sql, null);
  }

  async savepoint(name: string): Promise<Transaction> {
    this._checkLive();
    await this._db.execute("SAVEPOINT " + name);
    const tx = new Transaction(this._db, this, name);
    this._db._txs.push(tx);
    return tx;
  }

  async commit(): Promise<void> {
    this._checkLive();
    if (this._savepoint !== null) {
      await this._db.execute("RELEASE SAVEPOINT " + this._savepoint);
    } else {
      await this._db.execute("COMMIT");
    }
    this._done = true;
    this._popSelf();
  }

  async rollback(): Promise<void> {
    this._checkLive();
    if (this._savepoint !== null) {
      await this._db.execute("ROLLBACK TO SAVEPOINT " + this._savepoint);
      await this._db.execute("RELEASE SAVEPOINT " + this._savepoint);
    } else {
      await this._db.execute("ROLLBACK");
    }
    this._done = true;
    this._popSelf();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this._done) {
      return;
    }
    // A PgError thrown inside the transaction marks `_failed` on
    // Transaction.exec; clean exits commit, error exits roll back —
    // same semantics as @cutils/sqlite, documented in docs/subset-quirks.md.
    if (this._failed) {
      await this.rollback();
      return;
    }
    await this.commit();
  }
}
