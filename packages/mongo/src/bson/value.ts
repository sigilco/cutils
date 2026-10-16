// Wire-level BSON values (tagged union) + the plain-TS <-> tagged conversion
// layer for @cutils/mongo.
//
// `BsonDoc` is the shape the encoder/decoder and every class field hold:
// records of tagged-union values are concrete under scriptc, while records
// of `unknown` are not (SC2006/SC1090). User-facing `Document` records
// convert at the boundary: `toBsonDoc` on the way to the wire, `fromBsonDoc`
// on the way back.
//
// Dates: a `Date` cannot live in an `unknown` record slot under scriptc
// (native handles have no dynamic representation there). Decode therefore
// produces `BsonDate` — a program-class wrapper that IS representable in
// both runtimes — and encode accepts `Date`, `BsonDate`, or the
// `{ $bson: "date", v: ms }` tagged record. This is the same kind of
// subset-strict twin as sqlite's `get`/`getOrNull` split.

import { mongoError } from "../errors.ts";
import type { Document } from "../types.ts";
import { Binary } from "./binary.ts";
import { ObjectId } from "./objectid.ts";

/** Date value wrapper — the subset-clean stand-in for `Date` inside
 * decoded documents. `toDate()`/`toISOString()` work under plain Node and
 * in the ELF. */
export class BsonDate {
  ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  getTime(): number {
    return this.ms;
  }

  toDate(): Date {
    return new Date(this.ms);
  }

  toISOString(): string {
    return new Date(this.ms).toISOString();
  }

  toString(): string {
    return this.toISOString();
  }
}

/** Regex record produced by decoding BSON 0x0B (and accepted on encode). */
export interface BsonRegex {
  pattern: string;
  options: string;
}

export type BsonValue =
  | { kind: "double"; v: number }
  | { kind: "string"; v: string }
  | { kind: "object"; v: BsonDoc }
  | { kind: "array"; v: BsonValue[] }
  | { kind: "binary"; v: Uint8Array; subType: number }
  | { kind: "objectId"; v: string }
  | { kind: "boolean"; v: boolean }
  | { kind: "date"; v: number }
  | { kind: "null" }
  | { kind: "regex"; pattern: string; options: string }
  | { kind: "int32"; v: number }
  | { kind: "int64"; v: number; raw: bigint };

export interface BsonDoc {
  [k: string]: BsonValue;
}

// ---------- value constructors (explicit `key: value`, no shorthand) ---

export function vNull(): BsonValue {
  return { kind: "null" };
}
export function vBool(v: boolean): BsonValue {
  return { kind: "boolean", v: v };
}
export function vStr(v: string): BsonValue {
  return { kind: "string", v: v };
}
export function vDouble(v: number): BsonValue {
  return { kind: "double", v: v };
}
export function vI32(v: number): BsonValue {
  return { kind: "int32", v: v };
}
export function vI64(v: number): BsonValue {
  return { kind: "int64", v: v, raw: BigInt(v) };
}
export function vI64Raw(v: bigint): BsonValue {
  return { kind: "int64", v: Number(v), raw: v };
}
export function vObj(v: BsonDoc): BsonValue {
  return { kind: "object", v: v };
}
export function vArr(v: BsonValue[]): BsonValue {
  return { kind: "array", v: v };
}
export function vBin(v: Uint8Array, subType: number): BsonValue {
  return { kind: "binary", v: v, subType: subType };
}
export function vOid(v: string): BsonValue {
  return { kind: "objectId", v: v };
}
export function vDateMs(v: number): BsonValue {
  return { kind: "date", v: v };
}
export function vRegex(pattern: string, options: string): BsonValue {
  return { kind: "regex", pattern: pattern, options: options };
}

// ---------- reader helpers (0 / null / empty defaults) -----------------

export function hasKey(doc: BsonDoc, key: string): boolean {
  const v = doc[key];
  return typeof v !== "undefined";
}

export function getVal(doc: BsonDoc, key: string): BsonValue | null {
  const v = doc[key];
  if (typeof v === "undefined") {
    return null;
  }
  return v;
}

export function getNum(doc: BsonDoc, key: string): number {
  const v = doc[key];
  if (typeof v === "undefined") {
    return 0;
  }
  if (v.kind === "int32" || v.kind === "int64" || v.kind === "double") {
    return v.v;
  }
  return 0;
}

export function getStr(doc: BsonDoc, key: string): string {
  const v = doc[key];
  if (typeof v === "undefined" || v.kind !== "string") {
    return "";
  }
  return v.v;
}

export function getBool(doc: BsonDoc, key: string): boolean {
  const v = doc[key];
  if (typeof v === "undefined" || v.kind !== "boolean") {
    return false;
  }
  return v.v;
}

export function getDoc(doc: BsonDoc, key: string): BsonDoc | null {
  const v = doc[key];
  if (typeof v === "undefined" || v.kind !== "object") {
    return null;
  }
  return v.v;
}

export function getArr(doc: BsonDoc, key: string): BsonValue[] {
  const v = doc[key];
  if (typeof v === "undefined" || v.kind !== "array") {
    return [];
  }
  return v.v;
}

// ---------- user Document -> tagged BsonDoc ----------------------------

function isRegexRecord(doc: Document): boolean {
  const keys = Object.keys(doc);
  if (keys.length !== 2) {
    return false;
  }
  const pv = doc["pattern"];
  const ov = doc["options"];
  const p = keys.indexOf("pattern") >= 0;
  const o = keys.indexOf("options") >= 0;
  return p && o && typeof pv === "string" && typeof ov === "string";
}

/** Convert one user value to the tagged wire value. */
export function toBsonValue(v: unknown): BsonValue {
  if (v === null) {
    return vNull();
  }
  const t = typeof v;
  if (t === "string") {
    return vStr(v as string);
  }
  if (t === "boolean") {
    return vBool(v as boolean);
  }
  if (t === "number") {
    const n = v as number;
    if (Number.isInteger(n) && n <= 2147483647 && n >= -2147483648) {
      return vI32(n);
    }
    if (Number.isInteger(n) && n <= 9007199254740991 && n >= -9007199254740991) {
      return vI64(n);
    }
    return vDouble(n);
  }
  if (t === "bigint") {
    return vI64Raw(v as bigint);
  }
  if (t === "object") {
    if (v instanceof ObjectId) {
      return vOid(v.toHexString());
    }
    if (v instanceof Binary) {
      return vBin(v.bytes, v.subType);
    }
    if (v instanceof BsonDate) {
      return vDateMs(v.ms);
    }
    if (v instanceof Date) {
      // Plain-Node path — a Date can't enter an `unknown` record slot
      // under scriptc (in-subset users pass BsonDate).
      return vDateMs(v.getTime());
    }
    if (v instanceof Uint8Array) {
      return vBin(v, 0);
    }
    if (v instanceof RegExp) {
      return vRegex(v.source, v.flags);
    }
    if (Array.isArray(v)) {
      const items = v as unknown[];
      const out: BsonValue[] = [];
      for (let i = 0; i < items.length; i++) {
        out.push(toBsonValue(items[i]));
      }
      return vArr(out);
    }
    const doc = v as Document;
    if (isRegexRecord(doc)) {
      return vRegex(doc["pattern"] as string, doc["options"] as string);
    }
    // `{ $bson: "date", v: <ms> }` tagged passthrough for subset users.
    const tag = doc["$bson"];
    if (tag === "date" && typeof doc["v"] === "number") {
      return vDateMs(doc["v"] as number);
    }
    return vObj(toBsonDoc(doc));
  }
  if (t === "undefined") {
    return vNull();
  }
  throw mongoError("BsonType", "cannot BSON-encode value of type " + t);
}

/** Convert a user document record to the tagged wire document. */
export function toBsonDoc(doc: Document): BsonDoc {
  const out: BsonDoc = {};
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.indexOf("\x00") >= 0) {
      throw mongoError("BsonType", "BSON keys cannot contain NUL: " + k);
    }
    out[k] = toBsonValue(doc[k]);
  }
  return out;
}

// ---------- tagged BsonDoc -> user Document ----------------------------

/** Convert one tagged wire value to its user-facing form. */
export function fromBsonValue(v: BsonValue): unknown {
  switch (v.kind) {
    case "double":
    case "int32":
      return v.v;
    case "int64":
      return v.v;
    case "string":
      return v.v;
    case "boolean":
      return v.v;
    case "null":
      return null;
    case "objectId":
      return ObjectId.fromHex(v.v);
    case "binary":
      return new Binary(v.v, v.subType);
    case "date":
      return new BsonDate(v.v);
    case "regex":
      return { pattern: v.pattern, options: v.options };
    case "array": {
      const out: unknown[] = [];
      for (let i = 0; i < v.v.length; i++) {
        out.push(fromBsonValue(v.v[i]));
      }
      return out;
    }
    case "object":
      return fromBsonDoc(v.v);
  }
  return null;
}

/** Convert a decoded wire document to the user-facing record. */
export function fromBsonDoc(doc: BsonDoc): Document {
  const out: Document = {};
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out[k] = fromBsonValue(doc[k]);
  }
  return out;
}

// ---------- schema view -------------------------------------------------

/** Unwrap BSON classes to plain-TS values for schema validation:
 * ObjectId -> hex string, Binary -> Uint8Array, BsonDate -> ISO string. */
export function unwrapForSchema(v: unknown): unknown {
  if (v === null) {
    return null;
  }
  const t = typeof v;
  if (t === "object") {
    if (v instanceof ObjectId) {
      return v.toHexString();
    }
    if (v instanceof Binary) {
      return v.bytes;
    }
    if (v instanceof BsonDate) {
      return v.toISOString();
    }
    if (v instanceof Date) {
      return v.toISOString();
    }
    if (v instanceof Uint8Array) {
      return v;
    }
    if (Array.isArray(v)) {
      const items = v as unknown[];
      const out: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        out.push(unwrapForSchema(items[i]));
      }
      return out;
    }
    const doc = v as Document;
    const out: Document = {};
    const keys = Object.keys(doc);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out[k] = unwrapForSchema(doc[k]);
    }
    return out;
  }
  return v;
}
