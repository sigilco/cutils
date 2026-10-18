// Extended Query protocol: Parse / Bind / Describe / Execute / Sync, plus
// Close for explicit finalization. Statement names are per-connection
// monotonics ("cutils_pg_N") so `finalize()` maps to a server-side DEALLOCATE
// (Close 'S'), matching the spec's stmt-lifecycle contract.

import {
  B_CMD_COMPLETE,
  B_COPY_IN,
  B_COPY_OUT,
  B_DATA_ROW,
  B_ERROR,
  B_PARAM_DESC,
  B_ROW_DESC,
  decodeErrorFields,
  decodeRowCount,
  encBind,
  encClose,
  encDescribe,
  encExecute,
  encParse,
  encSync,
  joinFrames,
} from "./messages.ts";
import { decodeDataRow, decodeRowDescription } from "./rows.ts";
import type { ColDesc } from "./rows.ts";
import type { Exchange, PgSocket } from "./socket.ts";
import { PgError } from "../errors.ts";
import type { SqlValue } from "../types.ts";

export interface PreparedMeta {
  name: string;
  cols: ColDesc[];
  /** Parameter count from ParameterDescription. */
  paramCount: number;
}

export interface ExecResult {
  rows: SqlValue[][];
  rowCount: number;
  /** RowDescription when `describe` was requested, else empty. */
  cols: ColDesc[];
}

function copyError(): PgError {
  return new PgError({
    code: "0A000",
    message: "COPY is not supported in @cutils/postgres v1",
    severity: "ERROR",
    detail: null,
    hint: null,
    position: null,
  });
}

/**
 * Parse + Describe 'S' + Sync: prepares `sql` server-side as `name` and
 * returns its row-shape metadata. `cols` is empty for non-row statements.
 */
/** @param {import("./socket.js").PgSocket} sock @param {string} name @param {string} sql */
export async function prepareOn(sock: PgSocket, name: string, sql: string): Promise<PreparedMeta> {
  return sock.run(async (ex: Exchange) => {
    sock.send(joinFrames([encParse(name, sql), encDescribe("S", name), encSync()]));
    let cols: ColDesc[] = [];
    let paramCount = 0;
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
      if (m.type === B_PARAM_DESC) {
        paramCount = m.i16();
        continue;
      }
      if (m.type === B_ROW_DESC) {
        cols = decodeRowDescription(m);
        continue;
      }
      // ParseComplete, NoData — ignored.
    }
    if (err !== null) {
      throw err;
    }
    return { name: name, cols: cols, paramCount: paramCount };
  });
}

/**
 * Bind + Execute + Sync against an already-prepared statement. `texts` are
 * the wire-encoded (text format) params; `nulls` marks SQL NULL slots.
 * `cols` is the statement's RowDescription from prepare time — the portal
 * inherits it, so DataRows decode against it without a second Describe.
 * When `cols` is empty we ask for the portal's RowDescription instead.
 */
/**
 * @param {import("./socket.js").PgSocket} sock
 * @param {string} stmtName
 * @param {string[]} texts
 * @param {boolean[]} nulls
 * @param {{name: string, tableOid: number, attrNum: number, typeOid: number, typeSize: number, typeModifier: number, format: number}[]} knownCols
 * @param {number} maxRows
 */
export async function executeOn(
  sock: PgSocket,
  stmtName: string,
  texts: string[],
  nulls: boolean[],
  knownCols: ColDesc[],
  maxRows: number,
): Promise<ExecResult> {
  return sock.run(async (ex: Exchange) => {
    const frames: Uint8Array[] = [encBind(stmtName, texts, nulls)];
    if (knownCols.length === 0) {
      frames.push(encDescribe("P", ""));
    }
    frames.push(encExecute(maxRows));
    frames.push(encSync());
    sock.send(joinFrames(frames));
    let cols: ColDesc[] = knownCols;
    const rows: SqlValue[][] = [];
    let rowCount = 0;
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
      if (m.type === B_ROW_DESC) {
        cols = decodeRowDescription(m);
        continue;
      }
      if (m.type === B_DATA_ROW) {
        rows.push(decodeDataRow(m, cols));
        continue;
      }
      if (m.type === B_CMD_COMPLETE) {
        rowCount = decodeRowCount(m);
        continue;
      }
      if (m.type === B_COPY_IN || m.type === B_COPY_OUT) {
        err = copyError();
        continue;
      }
      // BindComplete, PortalSuspended, NoData — ignored.
    }
    if (err !== null) {
      throw err;
    }
    return { rows: rows, rowCount: rowCount, cols: cols };
  });
}

/**
 * Parse + Bind + Describe 'P' + Execute + Sync against the UNNAMED
 * statement: the `execute(sql, args)` path — no statement cache, one shot.
 */
/**
 * @param {import("./socket.js").PgSocket} sock
 * @param {string} sql
 * @param {string[]} texts
 * @param {boolean[]} nulls
 */
export async function queryUnnamed(
  sock: PgSocket,
  sql: string,
  texts: string[],
  nulls: boolean[],
): Promise<ExecResult> {
  return sock.run(async (ex: Exchange) => {
    const frames: Uint8Array[] = [
      encParse("", sql),
      encBind("", texts, nulls),
      encDescribe("P", ""),
      encExecute(0),
      encSync(),
    ];
    sock.send(joinFrames(frames));
    let cols: ColDesc[] = [];
    const rows: SqlValue[][] = [];
    let rowCount = 0;
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
      if (m.type === B_ROW_DESC) {
        cols = decodeRowDescription(m);
        continue;
      }
      if (m.type === B_DATA_ROW) {
        rows.push(decodeDataRow(m, cols));
        continue;
      }
      if (m.type === B_CMD_COMPLETE) {
        rowCount = decodeRowCount(m);
        continue;
      }
      if (m.type === B_COPY_IN || m.type === B_COPY_OUT) {
        err = copyError();
        continue;
      }
      // ParseComplete, BindComplete, ParameterDescription, NoData.
    }
    if (err !== null) {
      throw err;
    }
    return { rows: rows, rowCount: rowCount, cols: cols };
  });
}

/** Close 'S' + Sync: server-side DEALLOCATE for `finalize()`. */
/** @param {import("./socket.js").PgSocket} sock @param {string} name */
export async function closeStatement(sock: PgSocket, name: string): Promise<void> {
  return sock.run(async (ex: Exchange) => {
    if (sock.closed) {
      return;
    }
    sock.send(joinFrames([encClose("S", name), encSync()]));
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
      // CloseComplete, others ignored.
    }
    if (err !== null) {
      throw err;
    }
  });
}
