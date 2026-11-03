// Typed wrapper around the Rust `EchoPoint` echo. Layout matches
// `native/src/lib.rs`: i32 x, i32 y, u32 flags, 4 bytes padding, i64 value.

import { copyOut, ensure } from "./buffer.ts";
import { ffiEchoI32, ffiEchoI64, ffiEchoPoint, ffiEchoSize } from "./internal/ffi.ts";
import { readI32, readI64, readU32, writeI32, writeI64, writeU32 } from "./layout.ts";

export const ECHO_POINT_SIZE = 24;
export const ECHO_POINT_VALUE_OFFSET = 16;

export interface EchoPoint {
  x: number;
  y: number;
  flags: number;
  value: bigint;
}

export function encodeEchoPoint(point: EchoPoint): Uint8Array {
  const buf = new Uint8Array(ECHO_POINT_SIZE);
  writeI32(buf, 0, point.x);
  writeI32(buf, 4, point.y);
  writeU32(buf, 8, point.flags);
  writeI64(buf, ECHO_POINT_VALUE_OFFSET, point.value);
  return buf;
}

export function decodeEchoPoint(buf: Uint8Array): EchoPoint {
  return {
    x: readI32(buf, 0),
    y: readI32(buf, 4),
    flags: readU32(buf, 8),
    value: readI64(buf, ECHO_POINT_VALUE_OFFSET),
  };
}

export function echoSize(): number {
  return ffiEchoSize();
}

export function echoI32(value: number): number {
  return ffiEchoI32(value);
}

export function echoI64(value: bigint): bigint {
  // koffi returns a Number when the i64 fits in f64; scriptc returns bigint.
  return BigInt(ffiEchoI64(value));
}

/** Native decode + encode: returned `x` is `point.x + 1`. */
export function echoPoint(point: EchoPoint): EchoPoint {
  const input = encodeEchoPoint(point);
  let scratch: Uint8Array = new Uint8Array(ECHO_POINT_SIZE);
  const need = ffiEchoPoint(input, scratch);
  if (need < 0) {
    throw new Error("echo_point: input too small");
  }
  if (need > scratch.length) {
    scratch = ensure(scratch, need);
    const retry = ffiEchoPoint(input, scratch);
    if (retry !== need) {
      throw new Error("echo_point: retry size mismatch");
    }
  }
  return decodeEchoPoint(copyOut(scratch, ECHO_POINT_SIZE));
}
