// Byte plumbing for the wire protocol: a growable writer (encoder side)
// and an accumulation reader (decoder side). All wire integers are
// big-endian; the writer emits the `type byte + int32 length + payload`
// framing, the reader de-frames a TCP byte stream into whole messages.

const utf8 = new TextEncoder();

/** Growable byte buffer with big-endian primitives. */
export class Writer {
  _buf: Uint8Array;
  _len: number;

  constructor(capacity?: number) {
    let cap = 256;
    if (typeof capacity === "number" && capacity > 0) {
      cap = capacity;
    }
    this._buf = new Uint8Array(cap);
    this._len = 0;
  }

  _grow(need: number): void {
    if (this._len + need <= this._buf.length) {
      return;
    }
    let cap = this._buf.length * 2;
    while (cap < this._len + need) {
      cap = cap * 2;
    }
    const next = new Uint8Array(cap);
    next.set(this._buf.subarray(0, this._len));
    this._buf = next;
  }

  u8(v: number): void {
    this._grow(1);
    this._buf[this._len] = v & 255;
    this._len = this._len + 1;
  }

  i16(v: number): void {
    this._grow(2);
    this._buf[this._len] = (v >>> 8) & 255;
    this._buf[this._len + 1] = v & 255;
    this._len = this._len + 2;
  }

  i32(v: number): void {
    this._grow(4);
    this._buf[this._len] = (v >>> 24) & 255;
    this._buf[this._len + 1] = (v >>> 16) & 255;
    this._buf[this._len + 2] = (v >>> 8) & 255;
    this._buf[this._len + 3] = v & 255;
    this._len = this._len + 4;
  }

  bytes(b: Uint8Array): void {
    this._grow(b.length);
    this._buf.set(b, this._len);
    this._len = this._len + b.length;
  }

  /** UTF-8 string without terminator. */
  str(s: string): void {
    this.bytes(utf8.encode(s));
  }

  /** NUL-terminated UTF-8 string (wire "cstring"). */
  cstr(s: string): void {
    this.str(s);
    this.u8(0);
  }

  /** Raw copy of what has been written so far. */
  out(): Uint8Array {
    const r = new Uint8Array(this._len);
    r.set(this._buf.subarray(0, this._len));
    return r;
  }
}

/** Wrap the payload in the `type + int32 length` framing. */
export function frame(type: number, payload: Writer): Uint8Array {
  const w = new Writer(payload._len + 5);
  w.u8(type);
  w.i32(payload._len + 4);
  w.bytes(payload.out());
  return w.out();
}

/** Unframed message (startup-style packets have no type byte). */
export function frameHeadless(payload: Writer): Uint8Array {
  const w = new Writer(payload._len + 4);
  w.i32(payload._len + 4);
  w.bytes(payload.out());
  return w.out();
}

/** One de-framed backend message with cursor reads over its payload. */
export class Msg {
  type: number;
  _v: DataView;
  _b: Uint8Array;
  _off: number;

  constructor(type: number, payload: Uint8Array) {
    this.type = type;
    this._b = payload;
    this._v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    this._off = 0;
  }

  get remaining(): number {
    return this._b.length - this._off;
  }

  u8(): number {
    const v = this._v.getUint8(this._off);
    this._off = this._off + 1;
    return v;
  }

  i16(): number {
    const v = this._v.getInt16(this._off);
    this._off = this._off + 2;
    return v;
  }

  u16(): number {
    const v = this._v.getUint16(this._off);
    this._off = this._off + 2;
    return v;
  }

  i32(): number {
    const v = this._v.getInt32(this._off);
    this._off = this._off + 4;
    return v;
  }

  u32(): number {
    const v = this._v.getUint32(this._off);
    this._off = this._off + 4;
    return v;
  }

  take(n: number): Uint8Array {
    const r = new Uint8Array(n);
    r.set(this._b.subarray(this._off, this._off + n));
    this._off = this._off + n;
    return r;
  }

  /** Read a NUL-terminated string; cursor ends after the NUL. */
  cstr(): string {
    let end = this._off;
    while (end < this._b.length && this._b[end] !== 0) {
      end = end + 1;
    }
    const s = utf8DecodeRange(this._b, this._off, end);
    this._off = end + 1;
    return s;
  }

  text(n: number): string {
    const s = utf8DecodeRange(this._b, this._off, this._off + n);
    this._off = this._off + n;
    return s;
  }
}

const dec = new TextDecoder();

export function utf8DecodeRange(b: Uint8Array, start: number, end: number): string {
  return dec.decode(b.subarray(start, end));
}

export function utf8Decode(b: Uint8Array): string {
  return dec.decode(b);
}

/**
 * TCP stream de-framer: feed socket chunks, pop whole messages.
 * Header = 1 type byte + 4 length bytes (length includes itself).
 */
export class Reader {
  _buf: Uint8Array;
  _len: number;
  _off: number;

  constructor() {
    this._buf = new Uint8Array(8192);
    this._len = 0;
    this._off = 0;
  }

  feed(chunk: Uint8Array): void {
    if (this._len + chunk.length > this._buf.length) {
      this._compact();
    }
    if (this._len + chunk.length > this._buf.length) {
      let cap = this._buf.length * 2;
      while (cap < this._len + chunk.length) {
        cap = cap * 2;
      }
      const next = new Uint8Array(cap);
      next.set(this._buf.subarray(0, this._len));
      this._buf = next;
    }
    this._buf.set(chunk, this._len);
    this._len = this._len + chunk.length;
  }

  _compact(): void {
    if (this._off === 0) {
      return;
    }
    this._buf.copyWithin(0, this._off, this._len);
    this._len = this._len - this._off;
    this._off = 0;
  }

  /** Next whole message, or null when the stream is mid-message. */
  next(): Msg | null {
    const avail = this._len - this._off;
    if (avail < 5) {
      return null;
    }
    const v = new DataView(this._buf.buffer, this._buf.byteOffset + this._off, avail);
    const msgLen = v.getInt32(1);
    if (msgLen < 4) {
      return null;
    }
    if (avail < msgLen + 1) {
      return null;
    }
    const type = v.getUint8(0);
    const payload = new Uint8Array(msgLen - 4);
    payload.set(this._buf.subarray(this._off + 5, this._off + 1 + msgLen));
    this._off = this._off + 1 + msgLen;
    if (this._off === this._len) {
      this._off = 0;
      this._len = 0;
    }
    return new Msg(type, payload);
  }
}

const HEX: string = "0123456789abcdef";

export function hexEncode(b: Uint8Array): string {
  const w = new Writer(b.length * 2);
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    w.u8(HEX.charCodeAt(v >>> 4));
    w.u8(HEX.charCodeAt(v & 15));
  }
  return utf8Decode(w.out());
}
