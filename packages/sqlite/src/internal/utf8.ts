// string <-> UTF-8 helpers over TextEncoder/TextDecoder (subset-clean).

const encoder: TextEncoder = new TextEncoder();
const decoder: TextDecoder = new TextDecoder();

export function utf8Encode(s: string): Uint8Array {
  return encoder.encode(s);
}

/** Decode the first `n` bytes of `buf` as UTF-8. */
export function utf8Decode(buf: Uint8Array, n: number): string {
  return decoder.decode(buf.slice(0, n));
}
