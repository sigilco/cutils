// Scratch helpers for format-7 `mutable-bytes` out params.
// Copied in spirit from `@cutils/sqlite`'s `internal/buffer.ts`: grow until
// the shim's required-byte return fits, then copy out. Plain functions, not
// a class — a class instance stored as a field of another package class
// refuses under consumer `scriptc build` (sqlite's Scratch trap).

/** Grow `scratch` until `cap` bytes fit; returns the live buffer. */
export function ensure(scratch: Uint8Array, cap: number): Uint8Array {
  let n = scratch.length;
  if (n < 1) {
    n = 1;
  }
  while (n < cap) {
    n = n * 2;
  }
  if (n !== scratch.length) {
    return new Uint8Array(n);
  }
  return scratch;
}

/** Copy the first `n` bytes out (scratch is reused by the caller). */
export function copyOut(scratch: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = scratch[i];
  }
  return out;
}
