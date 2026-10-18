// Simple Query protocol: one 'Q' message, RowDescription + DataRow +
// CommandComplete responses until ReadyForQuery. Used for exec, SHOW/SET,
// BEGIN/COMMIT/SAVEPOINT, LISTEN/NOTIFY — anything without parameters.

import {
  B_CMD_COMPLETE,
  B_COPY_IN,
  B_COPY_OUT,
  B_DATA_ROW,
  B_ERROR,
  B_ROW_DESC,
  decodeErrorFields,
  decodeRowCount,
  encQuery,
} from "./messages.ts";
import { decodeDataRow, decodeRowDescription, rowFromValues } from "./rows.ts";
import type { ColDesc } from "./rows.ts";
import type { Exchange, PgSocket } from "./socket.ts";
import { PgError } from "../errors.ts";
import type { Row } from "../types.ts";

export interface SimpleResult {
  cols: ColDesc[];
  rows: Row[];
  rowCount: number;
}

function copyError(): PgError {
  return new PgError({
    code: "0A000",
    message: "COPY is not supported in @cutils/postgres v1",
    severity: "ERROR",
    detail: null,
    hint: "use server-side COPY ... TO STDOUT is a v2 ticket; run the query inside psql or a migration tool",
    position: null,
  });
}

/**
 * Run one simple query inside an exchange slot. Drains until
 * ReadyForQuery; throws PgError on ErrorResponse after the drain.
 */
/** @param {import("./socket.js").PgSocket} sock @param {string} sql */
export async function simpleQuery(sock: PgSocket, sql: string): Promise<SimpleResult> {
  return sock.run(async (ex: Exchange) => {
    sock.send(encQuery(sql));
    let cols: ColDesc[] = [];
    const rows: Row[] = [];
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
        rows.push(rowFromValues(cols, decodeDataRow(m, cols)));
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
      // EmptyQueryResponse, notices routed socket-side, others ignored.
    }
    if (err !== null) {
      throw err;
    }
    return { cols: cols, rows: rows, rowCount: rowCount };
  });
}
