// Reusable scratch buffer for the shim's mutable-bytes out params.
// Strings/blobs arrive as "required bytes" return values; when the buffer is
// too small it doubles until the call fits.
//
// Plain helpers, not a class: a `Scratch` instance stored as a class field
// crosses an internal module boundary and refuses under `scriptc build`
// when the package is compiled from a consumer's node_modules (subset trap).

/** Grow `scratch` until `cap` bytes fit; returns the live buffer. */
export function ensure(scratch: Uint8Array, cap: number): Uint8Array {
  let n = scratch.length;
  while (n < cap) {
    n = n * 2;
  }
  if (n !== scratch.length) {
    return new Uint8Array(n);
  }
  return scratch;
}

/** Copy the first `n` bytes out (for blob returns — scratch is reused). */
export function copyOut(scratch: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = scratch[i];
  }
  return out;
}
