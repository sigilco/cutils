// Reusable scratch buffer for the shim's mutable-bytes out params.
// Strings/blobs arrive as "required bytes" return values; when the buffer is
// too small it doubles until the call fits.

export class Scratch {
  buf: Uint8Array;

  constructor() {
    this.buf = new Uint8Array(4096);
  }

  /** Grow until `cap` bytes fit. */
  ensure(cap: number): void {
    let n = this.buf.length;
    while (n < cap) {
      n = n * 2;
    }
    if (n !== this.buf.length) {
      this.buf = new Uint8Array(n);
    }
  }

  /** Copy the first `n` bytes out (for blob returns — scratch is reused). */
  copyOut(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.buf[i];
    }
    return out;
  }
}
