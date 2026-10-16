// BSON ObjectId — 12 bytes: 4-byte big-endian seconds, 5-byte process-unique
// value (random once per process), 3-byte big-endian counter. Subset-clean:
// concrete fields only, no private slots.

import { randomBytes } from "node:crypto";

const PROC_UNIQUE: Uint8Array = randomBytes(5);
let counter: number = randomBytes(3)[0] * 65536 + randomBytes(3)[1] * 256 + randomBytes(3)[2];

function nextCounter(): number {
  counter = (counter + 1) % 16777216;
  return counter;
}

function hexDigit(c: number): number {
  if (c >= 48 && c <= 57) {
    return c - 48;
  }
  if (c >= 97 && c <= 102) {
    return c - 87;
  }
  if (c >= 65 && c <= 70) {
    return c - 55;
  }
  return -1;
}

export class ObjectId {
  bytes: Uint8Array;

  constructor(bytes?: Uint8Array) {
    if (typeof bytes === "undefined") {
      this.bytes = ObjectId._generateBytes();
      return;
    }
    if (bytes.length !== 12) {
      throw new Error("ObjectId requires exactly 12 bytes, got " + String(bytes.length));
    }
    this.bytes = new Uint8Array(12);
    for (let i = 0; i < 12; i++) {
      this.bytes[i] = bytes[i];
    }
  }

  static _generateBytes(): Uint8Array {
    const b = new Uint8Array(12);
    const t = Math.floor(Date.now() / 1000);
    b[0] = (t >>> 24) & 255;
    b[1] = (t >>> 16) & 255;
    b[2] = (t >>> 8) & 255;
    b[3] = t & 255;
    for (let i = 0; i < 5; i++) {
      b[4 + i] = PROC_UNIQUE[i];
    }
    const c = nextCounter();
    b[9] = (c >>> 16) & 255;
    b[10] = (c >>> 8) & 255;
    b[11] = c & 255;
    return b;
  }

  toHexString(): string {
    const HEX = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < 12; i++) {
      const b = this.bytes[i];
      s = s + HEX.charAt((b >>> 4) & 15) + HEX.charAt(b & 15);
    }
    return s;
  }

  equals(other: ObjectId): boolean {
    for (let i = 0; i < 12; i++) {
      if (this.bytes[i] !== other.bytes[i]) {
        return false;
      }
    }
    return true;
  }

  toString(): string {
    return this.toHexString();
  }

  static isHex(input: unknown): boolean {
    if (typeof input !== "string" || input.length !== 24) {
      return false;
    }
    for (let i = 0; i < 24; i++) {
      if (hexDigit(input.charCodeAt(i)) < 0) {
        return false;
      }
    }
    return true;
  }

  static fromHex(hex: string): ObjectId {
    if (!ObjectId.isHex(hex)) {
      throw new Error("ObjectId.fromHex requires a 24-char hex string");
    }
    const b = new Uint8Array(12);
    for (let i = 0; i < 12; i++) {
      const hi = hexDigit(hex.charCodeAt(i * 2));
      const lo = hexDigit(hex.charCodeAt(i * 2 + 1));
      b[i] = hi * 16 + lo;
    }
    return new ObjectId(b);
  }

  static generate(): ObjectId {
    return new ObjectId();
  }
}
