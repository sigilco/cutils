// BSON Binary — bytes plus a subtype tag (0 = generic, 4 = UUID, ...).

const HEX = "0123456789abcdef";

export class Binary {
  bytes: Uint8Array;
  subType: number;

  constructor(bytes: Uint8Array, subType: number = 0) {
    this.bytes = bytes;
    this.subType = subType;
  }

  /** Format the 16-byte subtype-4 payload as a UUID string. */
  toUUID(): string {
    if (this.bytes.length !== 16) {
      throw new Error("Binary.toUUID requires a 16-byte payload");
    }
    const b = this.bytes;
    let s = "";
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) {
        s = s + "-";
      }
      s = s + HEX.charAt((b[i] >>> 4) & 15) + HEX.charAt(b[i] & 15);
    }
    return s;
  }

  toString(): string {
    return "Binary(" + String(this.subType) + ", " + String(this.bytes.length) + " bytes)";
  }
}
