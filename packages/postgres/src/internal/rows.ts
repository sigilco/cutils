// DataRow decoding and bind-value encoding. v1 speaks the TEXT format in
// both directions (result format 0): every value crosses the wire as
// Postgres's canonical text, and the OID registry picks the JS type.
// Binary format is a v2 ticket.

import {
  OID_BOOL,
  OID_BYTEA,
  OID_INT8,
  OID_TIMESTAMP,
  OID_TIMESTAMPTZ,
  oidIsNumber,
} from "./oids.ts";
import { Msg, utf8Decode } from "./buffer.ts";
import type { SqlValue } from "../types.ts";

/** One column of a RowDescription. */
export interface ColDesc {
  name: string;
  tableOid: number;
  attrNum: number;
  typeOid: number;
  typeSize: number;
  typeModifier: number;
  format: number;
}

function decodeByteaHex(text: string): Uint8Array {
  // text format is "\x" + lowercase hex.
  let n = text.length - 2;
  if (n < 0 || (n & 1) !== 0) {
    n = 0;
  } else {
    n = n / 2;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const hi = hexNibble(text.charCodeAt(2 + i * 2));
    const lo = hexNibble(text.charCodeAt(3 + i * 2));
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function hexNibble(c: number): number {
  if (c >= 48 && c <= 57) {
    return c - 48;
  }
  if (c >= 97 && c <= 102) {
    return c - 87;
  }
  if (c >= 65 && c <= 70) {
    return c - 55;
  }
  return 0;
}

/**
 * `YYYY-MM-DD HH:MM:SS[.ffffff][+TZ]` → Date. Postgres emits a space (not
 * "T") and a `+HH[:MM]` offset; normalizing to ISO-8601 and handing to
 * `new Date(string)` keeps it in the lowered Date surface.
 */
function parseTimestamp(text: string): Date {
  let t = text;
  const sp = t.indexOf(" ");
  if (sp > 0) {
    t = t.slice(0, sp) + "T" + t.slice(sp + 1);
  }
  // BC suffix and the "+HH" short offset both sit past ISO-8601; Date
  // parses "+HHMM" and "+HH:MM" but not bare "+HH" — append ":00".
  const len = t.length;
  const last = t.charAt(len - 3);
  const sign = t.charAt(len - 3) === "+" || t.charAt(len - 3) === "-" ? last : "";
  if (sign !== "" && t.charAt(len - 2) >= "0" && t.charAt(len - 2) <= "9") {
    // ends in "+HH" or "-HH" exactly two digits
    const d1 = t.charAt(len - 2);
    const d2 = t.charAt(len - 1);
    if (d1 >= "0" && d1 <= "9" && d2 >= "0" && d2 <= "9") {
      t = t + ":00";
    }
  }
  return new Date(t);
}

/** Decode one TEXT-format column value to a SqlValue. */
export function decodeText(oid: number, text: string): SqlValue {
  if (oid === OID_BOOL) {
    return text === "t" || text === "true";
  }
  if (oid === OID_INT8) {
    const b = BigInt(text);
    const n = Number(b);
    if (Number.isSafeInteger(n)) {
      return n;
    }
    return b;
  }
  if (oidIsNumber(oid)) {
    return Number(text);
  }
  if (oid === OID_BYTEA) {
    return decodeByteaHex(text);
  }
  if (oid === OID_TIMESTAMP || oid === OID_TIMESTAMPTZ) {
    // DEVIATION: the spec typed timestamps as `Date`, but no union with a
    // `Date` arm lowers under scriptc 0.3.3 (SC2009 — no runtime narrowing
    // against sibling arms). v1 round-trips timestamps as ISO-8601 UTC
    // strings instead; callers `new Date(v)` themselves when they want one.
    return parseTimestamp(text).toISOString();
  }
  // date / time / interval / numeric / json / text / uuid / unknown OIDs:
  // raw text — lossless and documented.
  return text;
}

function isIdentByte(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
  );
}

/** Decode a DataRow into positional SqlValues for a RowDescription. */
export function decodeDataRow(msg: Msg, cols: ColDesc[]): SqlValue[] {
  const count = msg.i16();
  const out: SqlValue[] = [];
  for (let i = 0; i < count; i++) {
    const len = msg.i32();
    if (len === -1) {
      out.push(null);
      continue;
    }
    const oid = i < cols.length ? cols[i].typeOid : 0;
    out.push(decodeText(oid, msg.text(len)));
  }
  return out;
}

/** Parse a RowDescription payload into column descriptors. */
export function decodeRowDescription(msg: Msg): ColDesc[] {
  const count = msg.i16();
  const cols: ColDesc[] = [];
  for (let i = 0; i < count; i++) {
    cols.push({
      name: msg.cstr(),
      tableOid: msg.u32(),
      attrNum: msg.i16(),
      typeOid: msg.u32(),
      typeSize: msg.i16(),
      typeModifier: msg.i32(),
      format: msg.i16(),
    });
  }
  return cols;
}

/** Build a Row record from positional values + column names. */
export function rowFromValues(cols: ColDesc[], vals: SqlValue[]): Record<string, SqlValue> {
  const row: Record<string, SqlValue> = {};
  for (let i = 0; i < vals.length; i++) {
    const name = i < cols.length ? cols[i].name : "col" + String(i);
    row[name] = vals[i];
  }
  return row;
}

function pad2(n: number): string {
  if (n < 10) {
    return "0" + String(n);
  }
  return String(n);
}

const HEXS: string = "0123456789abcdef";

/** Uint8Array → bytea hex literal (`\x...`). */
function encodeBytea(b: Uint8Array): string {
  let s = "\\x";
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    s = s + HEXS.charAt(v >>> 4) + HEXS.charAt(v & 15);
  }
  return s;
}

/** BindValue → wire text (Bind params are text-format in v1). */
export function encodeText(v: SqlValue): string {
  if (v === null) {
    return "";
  }
  if (typeof v === "boolean") {
    return v ? "t" : "f";
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "object" && v !== null) {
    return encodeBytea(v);
  }
  return String(v);
}

export { utf8Decode, isIdentByte, pad2 };
