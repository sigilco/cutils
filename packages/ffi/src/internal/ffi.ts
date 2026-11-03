// declare-function bindings for native/src/lib.rs.
// These must match vendor/manifest.json exactly (names, arity, types).
// Span ABI: `bytes` params marshal as (ptr,len) — the declare passes only
// the Uint8Array; `mutable-bytes` out params marshal as (buf,len). Ambient
// declarations cannot be exported. Under plain Node the emitted calls
// resolve on globalThis — test/koffi-binding.mjs installs matching globals.

declare function echo_size(): number;
declare function echo_i32(value: number): number;
declare function echo_i64(value: bigint): bigint;
declare function echo_point(input: Uint8Array, output: Uint8Array): number;

export function ffiEchoSize(): number {
  return echo_size();
}

export function ffiEchoI32(value: number): number {
  return echo_i32(value);
}

export function ffiEchoI64(value: bigint): bigint {
  return echo_i64(value);
}

export function ffiEchoPoint(input: Uint8Array, output: Uint8Array): number {
  return echo_point(input, output);
}
