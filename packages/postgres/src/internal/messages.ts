// Wire message encoders (frontend) and the small backend parsers that are
// not row-shaped (ErrorResponse, NoticeResponse, ParameterStatus,
// NotificationResponse, auth frames). Plus the SQL named-parameter
// scanner that rewrites `:name`/`@name`/`$name` to `$N` positional.

import { Msg, Writer, frame, frameHeadless } from "./buffer.ts";
import type { PgErrorFields } from "../errors.ts";

// Frontend message type bytes.
export const F_PASSWORD: number = 112; // 'p' (password/SASL response)
export const F_QUERY: number = 81; // 'Q'
export const F_PARSE: number = 80; // 'P'
export const F_BIND: number = 66; // 'B'
export const F_DESCRIBE: number = 68; // 'D'
export const F_EXECUTE: number = 69; // 'E'
export const F_SYNC: number = 83; // 'S'
export const F_CLOSE: number = 67; // 'C'
export const F_FLUSH: number = 72; // 'H'
export const F_TERMINATE: number = 88; // 'X'

// Backend message type bytes.
export const B_AUTH: number = 82; // 'R'
export const B_PARAM_STATUS: number = 83; // 'S'
export const B_BACKEND_KEY: number = 75; // 'K'
export const B_READY: number = 90; // 'Z'
export const B_ROW_DESC: number = 84; // 'T'
export const B_DATA_ROW: number = 68; // 'D'
export const B_CMD_COMPLETE: number = 67; // 'C'
export const B_EMPTY: number = 73; // 'I'
export const B_ERROR: number = 69; // 'E'
export const B_NOTICE: number = 78; // 'N'
export const B_NOTIFY: number = 65; // 'A'
export const B_PARSE_COMPLETE: number = 49; // '1'
export const B_BIND_COMPLETE: number = 50; // '2'
export const B_CLOSE_COMPLETE: number = 51; // '3'
export const B_NO_DATA: number = 110; // 'n'
export const B_PORTAL_SUSPENDED: number = 115; // 's'
export const B_PARAM_DESC: number = 116; // 't'
export const B_COPY_IN: number = 71; // 'G'
export const B_COPY_OUT: number = 72; // 'H'

export const PROTO_VERSION: number = 196608; // 3.0
export const CANCEL_CODE: number = 80877102;
export const SSL_CODE: number = 80877103;

// Authentication request codes (payload of 'R').
export const AUTH_OK: number = 0;
export const AUTH_CLEARTEXT: number = 3;
export const AUTH_MD5: number = 5;
export const AUTH_SASL: number = 10;
export const AUTH_SASL_CONTINUE: number = 11;
export const AUTH_SASL_FINAL: number = 12;

/** StartupMessage: unframed, version 3.0 + key/value pairs + NUL. */
/** @param {Record<string, string>} params @returns {Uint8Array} */
export function encStartup(params: Record<string, string>): Uint8Array {
  const w = new Writer();
  w.i32(PROTO_VERSION);
  const keys = Object.keys(params);
  for (let i = 0; i < keys.length; i++) {
    w.cstr(keys[i]);
    w.cstr(params[keys[i]]);
  }
  w.u8(0);
  return frameHeadless(w);
}

/** CancelRequest: unframed, cancel code + pid + secret. */
/** @param {number} pid @param {number} secret @returns {Uint8Array} */
export function encCancel(pid: number, secret: number): Uint8Array {
  const w = new Writer(16);
  w.i32(CANCEL_CODE);
  w.i32(pid);
  w.i32(secret);
  return frameHeadless(w);
}

/** SSLRequest: unframed, ssl code only. */
export function encSslRequest(): Uint8Array {
  const w = new Writer(8);
  w.i32(SSL_CODE);
  return frameHeadless(w);
}

/** @param {Uint8Array} payload @returns {Uint8Array} */
export function encPassword(payload: Uint8Array): Uint8Array {
  const w = new Writer(payload.length);
  w.bytes(payload);
  return frame(F_PASSWORD, w);
}

/** @param {string} sql @returns {Uint8Array} */
export function encQuery(sql: string): Uint8Array {
  const w = new Writer(sql.length + 1);
  w.cstr(sql);
  return frame(F_QUERY, w);
}

/** @param {string} name @param {string} sql @returns {Uint8Array} */
export function encParse(name: string, sql: string): Uint8Array {
  const w = new Writer();
  w.cstr(name);
  w.cstr(sql);
  w.i16(0); // no param-type OIDs: server infers
  return frame(F_PARSE, w);
}

/** @param {string} kind @param {string} name @returns {Uint8Array} */
export function encDescribe(kind: string, name: string): Uint8Array {
  const w = new Writer(name.length + 2);
  w.u8(kind.charCodeAt(0)); // 'S' statement | 'P' portal
  w.cstr(name);
  return frame(F_DESCRIBE, w);
}

/** @param {string} stmtName @param {string[]} texts @param {boolean[]} nulls @returns {Uint8Array} */
export function encBind(stmtName: string, texts: string[], nulls: boolean[]): Uint8Array {
  const w = new Writer();
  w.cstr(""); // unnamed portal
  w.cstr(stmtName);
  w.i16(0); // all params text format
  w.i16(texts.length);
  for (let i = 0; i < texts.length; i++) {
    if (nulls[i]) {
      w.i32(-1);
    } else {
      const b = enc8.encode(texts[i]);
      w.i32(b.length);
      w.bytes(b);
    }
  }
  w.i16(1); // one result format code follows
  w.i16(0); // text
  return frame(F_BIND, w);
}

const enc8 = new TextEncoder();

/** @param {number} maxRows @returns {Uint8Array} */
export function encExecute(maxRows: number): Uint8Array {
  const w = new Writer(5);
  w.cstr(""); // unnamed portal
  w.i32(maxRows); // 0 = all
  return frame(F_EXECUTE, w);
}

/** @param {string} kind @param {string} name @returns {Uint8Array} */
export function encClose(kind: string, name: string): Uint8Array {
  const w = new Writer(name.length + 2);
  w.u8(kind.charCodeAt(0));
  w.cstr(name);
  return frame(F_CLOSE, w);
}

export function encSync(): Uint8Array {
  return frame(F_SYNC, new Writer(0));
}

export function encFlush(): Uint8Array {
  return frame(F_FLUSH, new Writer(0));
}

export function encTerminate(): Uint8Array {
  return frame(F_TERMINATE, new Writer(0));
}

/** Concatenate frames into one socket write. */
/** @param {Uint8Array[]} frames @returns {Uint8Array} */
export function joinFrames(frames: Uint8Array[]): Uint8Array {
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    total = total + frames[i].length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < frames.length; i++) {
    out.set(frames[i], off);
    off = off + frames[i].length;
  }
  return out;
}

// ---------- Backend parsers ----------

/** Parse ErrorResponse / NoticeResponse field bytes into PgErrorFields. */
/** @param {import("./buffer.js").Msg} msg */
export function decodeErrorFields(msg: Msg): PgErrorFields {
  let code = "";
  let message = "";
  let severity = "ERROR";
  let detail: string | null = null;
  let hint: string | null = null;
  let position: number | null = null;
  while (msg.remaining > 0) {
    const t = msg.u8();
    if (t === 0) {
      break;
    }
    const v = msg.cstr();
    if (t === 83 || t === 86) {
      // S severity (localized), V severity (always English) — prefer V.
      if (severity === "ERROR" || t === 86) {
        severity = v;
      }
    } else if (t === 67) {
      code = v; // C SQLSTATE
    } else if (t === 77) {
      message = v; // M message
    } else if (t === 68) {
      detail = v; // D detail
    } else if (t === 72) {
      hint = v; // H hint
    } else if (t === 80) {
      const n = Number.parseInt(v, 10);
      position = Number.isNaN(n) ? null : n; // P position
    }
  }
  if (message.length === 0) {
    message = "postgres error " + code;
  }
  return {
    code: code,
    message: message,
    severity: severity,
    detail: detail,
    hint: hint,
    position: position,
  };
}

export interface NotifyMsg {
  pid: number;
  channel: string;
  payload: string;
}

/** @param {Msg} msg */
export function decodeNotify(msg: Msg): NotifyMsg {
  const pid = msg.i32();
  const channel = msg.cstr();
  const payload = msg.cstr();
  return { pid: pid, channel: channel, payload: payload };
}

export interface ParamStatus {
  name: string;
  value: string;
}

/** @param {Msg} msg */
export function decodeParamStatus(msg: Msg): ParamStatus {
  const name = msg.cstr();
  const value = msg.cstr();
  return { name: name, value: value };
}

/** CommandComplete tag → affected row count (last int in the tag). */
/** @param {import("./buffer.js").Msg} msg */
export function decodeRowCount(msg: Msg): number {
  const tag = msg.cstr();
  let end = tag.length;
  let start = end;
  while (start > 0 && tag.charAt(start - 1) >= "0" && tag.charAt(start - 1) <= "9") {
    start = start - 1;
  }
  if (start === end) {
    return 0;
  }
  const n = Number.parseInt(tag.slice(start, end), 10);
  if (Number.isNaN(n)) {
    return 0;
  }
  return n;
}

// ---------- Named-parameter scanner ----------

export interface ScannedSql {
  /** SQL with every named placeholder rewritten to `$N`. */
  sql: string;
  /** Placeholder names in first-appearance order ("" for $N positionals). */
  names: string[];
}

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isIdent(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57) || c === 36;
}
function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/**
 * Rewrite `:name` / `@name` / `$name` placeholders to `$N` positional.
 * `$<digits>` stays positional and is counted as an anonymous slot.
 * String literals, quoted identifiers, comments, dollar-quoted bodies and
 * the `::` cast operator are skipped.
 */
/** @param {string} src */
export function scanParams(src: string): ScannedSql {
  const names: string[] = [];
  let out = "";
  let i = 0;
  const n = src.length;
  // state: 0 normal, 1 single-quote, 2 double-quote, 3 line comment,
  //        4 block comment, 5 dollar-quote
  let state = 0;
  let dollarTag = "";

  const pushName = (name: string): number => {
    for (let k = 0; k < names.length; k++) {
      if (names[k] === name) {
        return k + 1;
      }
    }
    names.push(name);
    return names.length;
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (state === 1) {
      out = out + src.charAt(i);
      if (c === 39) {
        if (i + 1 < n && src.charCodeAt(i + 1) === 39) {
          out = out + src.charAt(i + 1);
          i = i + 1;
        } else {
          state = 0;
        }
      }
      i = i + 1;
      continue;
    }
    if (state === 2) {
      out = out + src.charAt(i);
      if (c === 34) {
        state = 0;
      }
      i = i + 1;
      continue;
    }
    if (state === 3) {
      out = out + src.charAt(i);
      if (c === 10) {
        state = 0;
      }
      i = i + 1;
      continue;
    }
    if (state === 4) {
      out = out + src.charAt(i);
      if (c === 42 && i + 1 < n && src.charCodeAt(i + 1) === 47) {
        out = out + src.charAt(i + 1);
        i = i + 1;
        state = 0;
      }
      i = i + 1;
      continue;
    }
    if (state === 5) {
      // inside $tag$ ... $tag$
      if (src.indexOf(dollarTag, i) === i) {
        out = out + dollarTag;
        i = i + dollarTag.length;
        state = 0;
      } else {
        out = out + src.charAt(i);
        i = i + 1;
      }
      continue;
    }
    // normal
    if (c === 39) {
      state = 1;
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 34) {
      state = 2;
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 45 && i + 1 < n && src.charCodeAt(i + 1) === 45) {
      state = 3;
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 47 && i + 1 < n && src.charCodeAt(i + 1) === 42) {
      state = 4;
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 36) {
      // '$' — dollar-quote start ($tag$), positional ($N), or named ($name)
      let j = i + 1;
      while (j < n && isDigit(src.charCodeAt(j))) {
        j = j + 1;
      }
      if (j > i + 1 && (j >= n || !isIdent(src.charCodeAt(j)))) {
        // $N positional — count the anonymous slot
        pushName("");
        out = out + src.slice(i, j);
        i = j;
        continue;
      }
      // try dollar-quote: $tag$ where tag is ident* or empty
      let k = i + 1;
      while (k < n && src.charCodeAt(k) !== 36 && isIdent(src.charCodeAt(k))) {
        k = k + 1;
      }
      if (k < n && src.charCodeAt(k) === 36) {
        const tag = src.slice(i, k + 1);
        // is it really a dollar-quote tag (ident chars only, may be empty)?
        dollarTag = tag;
        state = 5;
        out = out + tag;
        i = k + 1;
        continue;
      }
      // $name named placeholder
      if (i + 1 < n && isIdentStart(src.charCodeAt(i + 1))) {
        let e = i + 1;
        while (e < n && isIdent(src.charCodeAt(e))) {
          e = e + 1;
        }
        const pos = pushName(src.slice(i + 1, e));
        out = out + "$" + String(pos);
        i = e;
        continue;
      }
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 58) {
      // ':' — named :name, but '::' is the cast operator
      if (i + 1 < n && src.charCodeAt(i + 1) === 58) {
        out = out + "::";
        i = i + 2;
        continue;
      }
      if (i + 1 < n && isIdentStart(src.charCodeAt(i + 1))) {
        let e = i + 1;
        while (e < n && isIdent(src.charCodeAt(e))) {
          e = e + 1;
        }
        const pos = pushName(src.slice(i + 1, e));
        out = out + "$" + String(pos);
        i = e;
        continue;
      }
      out = out + src.charAt(i);
      i = i + 1;
      continue;
    }
    if (c === 64 && i + 1 < n && isIdentStart(src.charCodeAt(i + 1))) {
      // '@name'
      let e = i + 1;
      while (e < n && isIdent(src.charCodeAt(e))) {
        e = e + 1;
      }
      const pos = pushName(src.slice(i + 1, e));
      out = out + "$" + String(pos);
      i = e;
      continue;
    }
    out = out + src.charAt(i);
    i = i + 1;
  }
  return { sql: out, names: names };
}
