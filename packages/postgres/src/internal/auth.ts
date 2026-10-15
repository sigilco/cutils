// SCRAM-SHA-256 client (RFC 5802 / RFC 7677) plus cleartext and MD5
// password auth. All crypto goes through node:crypto — the scriptc-lowered
// surface (pbkdf2, createHmac, createHash, randomBytes, timingSafeEqual).
//
// Reference: PerryTS/postgres src/auth/scram.ts (MIT, skelpo) — the shape
// is borrowed, the implementation is ours.

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { Writer, hexEncode, utf8Decode } from "./buffer.ts";
import type { Exchange } from "./socket.ts";
import {
  AUTH_CLEARTEXT,
  AUTH_MD5,
  AUTH_OK,
  AUTH_SASL,
  AUTH_SASL_CONTINUE,
  AUTH_SASL_FINAL,
  encPassword,
} from "./messages.ts";
import { PgError } from "../errors.ts";

function scramError(msg: string): PgError {
  return new PgError({
    code: "28000",
    message: msg,
    severity: "ERROR",
    detail: null,
    hint: null,
    position: null,
  });
}

function hmacSha256(key: Uint8Array, data: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(data).digest());
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function md5Hex(data: string): string {
  return createHash("md5").update(data).digest("hex");
}

function b64encode(b: Uint8Array): string {
  // Minimal base64 — scriptc's lowered surface has no Buffer.
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i + 2 < b.length; i = i + 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out =
      out +
      table.charAt(n >>> 18) +
      table.charAt((n >>> 12) & 63) +
      table.charAt((n >>> 6) & 63) +
      table.charAt(n & 63);
  }
  const rem = b.length % 3;
  if (rem === 1) {
    const n = b[b.length - 1] << 16;
    out = out + table.charAt(n >>> 18) + table.charAt((n >>> 12) & 63) + "==";
  } else if (rem === 2) {
    const n = (b[b.length - 2] << 16) | (b[b.length - 1] << 8);
    out =
      out +
      table.charAt(n >>> 18) +
      table.charAt((n >>> 12) & 63) +
      table.charAt((n >>> 6) & 63) +
      "=";
  }
  return out;
}

function b64decode(s: string): Uint8Array {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const rev: number[] = [];
  for (let i = 0; i < 128; i++) {
    rev.push(-1);
  }
  for (let i = 0; i < 64; i++) {
    rev[table.charCodeAt(i)] = i;
  }
  const out = new Writer();
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61) {
      break; // '='
    }
    const v = c < 128 ? rev[c] : -1;
    if (v < 0) {
      continue;
    }
    acc = (acc << 6) | v;
    bits = bits + 6;
    if (bits >= 8) {
      bits = bits - 8;
      out.u8((acc >>> bits) & 255);
    }
  }
  return out.out();
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

/** SASL-escape a username: `=` → `=3D`, `,` → `=2C`. */
function scramName(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "=") {
      out = out + "=3D";
    } else if (c === ",") {
      out = out + "=2C";
    } else {
      out = out + c;
    }
  }
  return out;
}

interface ScramState {
  clientNonce: string;
  clientFirstBare: string;
}

function parseAttr(msg: string, key: string): string {
  // server-first/final are `k=v,k=v,...`; v runs to the next comma.
  const prefix = key + "=";
  let i = 0;
  while (i < msg.length) {
    let j = msg.indexOf(",", i);
    if (j < 0) {
      j = msg.length;
    }
    const part = msg.slice(i, j);
    if (part.indexOf(prefix) === 0) {
      return part.slice(prefix.length);
    }
    i = j + 1;
  }
  return "";
}

export class Scram {
  _password: string;
  _user: string;
  _state: ScramState | null;
  _serverSignature: Uint8Array | null;

  constructor(user: string, password: string) {
    this._user = user;
    this._password = password;
    this._state = null;
    this._serverSignature = null;
  }

  /** Mechanism list offered for SASLInitialResponse. */
  mechanism(): string {
    return "SCRAM-SHA-256";
  }

  /** SASLInitialResponse inner payload: `n,,` + client-first-message-bare. */
  initialResponse(): Uint8Array {
    const nonceBytes = randomBytes(18);
    const nonce = b64encode(nonceBytes);
    const bare = "n=" + scramName(this._user) + ",r=" + nonce;
    this._state = { clientNonce: nonce, clientFirstBare: bare };
    const msg = "n,," + bare;
    const enc = new TextEncoder();
    return enc.encode(msg);
  }

  /** SASLContinue (auth 11) → SASLResponse payload. */
  serverFirst(serverFirst: string): Uint8Array {
    const st = this._state;
    if (st === null) {
      throw scramError("SCRAM state lost");
    }
    const nonce = parseAttr(serverFirst, "r");
    const saltB64 = parseAttr(serverFirst, "s");
    const iterStr = parseAttr(serverFirst, "i");
    if (nonce.indexOf(st.clientNonce) !== 0) {
      throw scramError("SCRAM server nonce mismatch");
    }
    const iterations = Number.parseInt(iterStr, 10);
    if (!(iterations > 0)) {
      throw scramError("SCRAM bad iteration count");
    }
    const salt = b64decode(saltB64);
    const salted = new Uint8Array(pbkdf2Sync(this._password, salt, iterations, 32, "sha256"));
    const clientKey = hmacSha256(salted, "Client Key");
    const storedKey = sha256(clientKey);
    const clientFinalBare = "c=biws,r=" + nonce;
    const authMessage = st.clientFirstBare + "," + serverFirst + "," + clientFinalBare;
    const clientSignature = hmacSha256(storedKey, authMessage);
    const proof = xorBytes(clientKey, clientSignature);
    const serverKey = hmacSha256(salted, "Server Key");
    this._serverSignature = hmacSha256(serverKey, authMessage);
    const finalMsg = clientFinalBare + ",p=" + b64encode(proof);
    const enc = new TextEncoder();
    return enc.encode(finalMsg);
  }

  /** SASLFinal (auth 12) → verifies `v=` server signature. */
  serverFinal(serverFinal: string): void {
    const v = parseAttr(serverFinal, "v");
    if (v.length === 0) {
      const e = parseAttr(serverFinal, "e");
      throw scramError(e.length > 0 ? "SCRAM server error: " + e : "SCRAM missing signature");
    }
    const expected = this._serverSignature;
    if (expected === null) {
      throw scramError("SCRAM state lost");
    }
    const got = b64decode(v);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw scramError("SCRAM server signature mismatch");
    }
  }
}

/**
 * Drive the authentication phase against an open exchange. Consumes 'R'
 * messages until AuthenticationOk; returns when auth is done (the caller
 * keeps reading until ReadyForQuery).
 */
export async function authenticate(
  ex: Exchange,
  send: (b: Uint8Array) => void,
  user: string,
  password: string,
): Promise<void> {
  let scram: Scram | null = null;
  for (;;) {
    const m = await ex.next();
    if (m === null) {
      throw scramError("connection closed during authentication");
    }
    if (m.type !== 82) {
      // 'R' — forward anything else (ParameterStatus etc. is dispatched
      // socket-side; only auth frames reach the exchange pre-ready).
      continue;
    }
    const sub = m.i32();
    if (sub === AUTH_OK) {
      return;
    }
    if (sub === AUTH_CLEARTEXT) {
      const w = new Writer();
      w.cstr(password);
      send(encPassword(w.out()));
      continue;
    }
    if (sub === AUTH_MD5) {
      const salt = m.take(4);
      const inner = md5Hex(password + user);
      const hex = hexEncode(salt);
      const outer = md5Hex(inner + hex);
      const w = new Writer();
      w.cstr("md5" + outer);
      send(encPassword(w.out()));
      continue;
    }
    if (sub === AUTH_SASL) {
      // Mechanism list: cstrings; require SCRAM-SHA-256.
      let ok = false;
      while (m.remaining > 1) {
        const mech = m.cstr();
        if (mech === "SCRAM-SHA-256") {
          ok = true;
        }
      }
      if (!ok) {
        throw scramError("server offers no SCRAM-SHA-256");
      }
      scram = new Scram(user, password);
      const inner = scram.initialResponse();
      const w = new Writer();
      w.cstr(scram.mechanism());
      w.i32(inner.length);
      w.bytes(inner);
      send(encPassword(w.out()));
      continue;
    }
    if (sub === AUTH_SASL_CONTINUE) {
      if (scram === null) {
        throw scramError("SCRAM continuation without init");
      }
      const serverFirst = utf8Decode(m.take(m.remaining));
      send(encPassword(scram.serverFirst(serverFirst)));
      continue;
    }
    if (sub === AUTH_SASL_FINAL) {
      if (scram === null) {
        throw scramError("SCRAM final without init");
      }
      scram.serverFinal(utf8Decode(m.take(m.remaining)));
      continue;
    }
    throw scramError("unsupported auth request " + String(sub));
  }
}
