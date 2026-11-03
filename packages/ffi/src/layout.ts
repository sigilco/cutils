// Little-endian field accessors for `#[repr(C)]` structs on LE hosts.
// scriptc format 7 does not marshal structs: callers pack into `bytes` /
// `mutable-bytes` with these helpers, matching native layout.

export function writeI32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

export function readI32(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

export function writeU32(buf: Uint8Array, offset: number, value: number): void {
  writeI32(buf, offset, value);
}

export function readU32(buf: Uint8Array, offset: number): number {
  return readI32(buf, offset) >>> 0;
}

export function writeI64(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  const mask = BigInt(255);
  const eight = BigInt(8);
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number(v & mask);
    v = v >> eight;
  }
}

export function readI64(buf: Uint8Array, offset: number): bigint {
  let v = BigInt(0);
  const eight = BigInt(8);
  for (let i = 7; i >= 0; i--) {
    v = (v << eight) | BigInt(buf[offset + i]);
  }
  const bits = BigInt(64);
  const sign = BigInt(1) << (bits - BigInt(1));
  return (v ^ sign) - sign;
}
