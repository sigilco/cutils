// SCRAM-SHA-1 / SCRAM-SHA-256 client proof (RFC 5802 + MongoDB sasl
// conversation). Pure node:crypto — pbkdf2Sync for the salted password,
// HMAC-SHA1/SHA256 for keys/signature, randomBytes for the client nonce.
// `conversation` is one saslStart/saslContinue round trip on the session.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { mongoError } from "../errors.ts";
import { getBool, getNum, getVal, vBool, vObj } from "../bson/value.ts";
import type { BsonDoc } from "../bson/value.ts";
import { vBin, vI32, vStr } from "../bson/value.ts";
import { utf8Decode, utf8Encode } from "./utf8.ts";

function b64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function hmac(algo: string, key: Uint8Array, msg: string): Uint8Array {
  return new Uint8Array(createHmac(algo, key).update(utf8Encode(msg)).digest());
}

function md5hex(s: string): string {
  return createHash("md5").update(utf8Encode(s)).digest("hex");
}

function hi(algo: string, password: string, salt: Uint8Array, iters: number): Uint8Array {
  return new Uint8Array(
    pbkdf2Sync(utf8Encode(password), salt, iters, algo === "sha1" ? 20 : 32, algo),
  );
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

function parseKv(s: string): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  const parts = s.split(",");
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq > 0) {
      out[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
    }
  }
  return out;
}

export interface ScramOptions {
  mechanism: string; // "SCRAM-SHA-1" | "SCRAM-SHA-256"
  username: string;
  password: string;
  authDb: string;
}

/**
 * Run the SCRAM conversation against `runCommand(db, spec)`.
 * `runCommand` sends one OP_MSG command doc and returns the decoded body.
 */
export async function scramAuth(
  runCommand: (db: string, spec: BsonDoc) => Promise<BsonDoc>,
  opts: ScramOptions,
): Promise<void> {
  const algo = opts.mechanism === "SCRAM-SHA-1" ? "sha1" : "sha256";
  // Password digest differs: SHA-1 uses md5("user:mongo:pass"), SHA-256 uses
  // saslprep(pass) — NFKC normalize is our subset-safe saslprep fallback.
  let password = opts.password;
  if (algo === "sha1") {
    password = md5hex(opts.username + ":mongo:" + opts.password);
  } else {
    password = opts.password.normalize("NFKC");
  }
  const cleanUser = opts.username.replace(/[=,]/g, "");
  const clientNonce = b64(randomBytes(24));
  const bare = "n=" + cleanUser + ",r=" + clientNonce;
  const clientFirst = "n,," + bare;

  const startDoc: BsonDoc = {};
  startDoc["saslStart"] = vI32(1);
  startDoc["mechanism"] = vStr(opts.mechanism);
  startDoc["payload"] = vBin(utf8Encode(clientFirst), 0);
  startDoc["autoAuthorize"] = vI32(1);
  const optDoc: BsonDoc = {};
  optDoc["skipEmptyExchange"] = vBool(true);
  startDoc["options"] = vObj(optDoc);
  let reply = await runCommand(opts.authDb, startDoc);
  const convId = getNum(reply, "conversationId");
  const serverFirstBin = getVal(reply, "payload");
  let serverFirst = "";
  if (serverFirstBin !== null && serverFirstBin.kind === "binary") {
    serverFirst = utf8Decode(serverFirstBin.v, serverFirstBin.v.length);
  }
  const sf = parseKv(serverFirst);
  const rnonce = sf["r"];
  const saltB64 = sf["s"];
  const iters = parseInt(sf["i"], 10);
  if (
    typeof rnonce === "undefined" ||
    typeof saltB64 === "undefined" ||
    !rnonce.startsWith(clientNonce)
  ) {
    throw mongoError("AuthError", "malformed server-first-message");
  }
  const salt = unb64(saltB64);
  const channelBinding = "c=biws";
  const withoutProof = channelBinding + ",r=" + rnonce;

  const salted = hi(algo, password, salt, iters);
  const clientKey = hmac(algo, salted, "Client Key");
  const storedKey =
    algo === "sha1"
      ? new Uint8Array(createHash("sha1").update(clientKey).digest())
      : new Uint8Array(createHash("sha256").update(clientKey).digest());
  const authMessage = bare + "," + serverFirst + "," + withoutProof;
  const clientSig = hmac(algo, storedKey, authMessage);
  const proof = xorBytes(clientKey, clientSig);
  const finalClient = withoutProof + ",p=" + b64(proof);

  const contDoc: BsonDoc = {};
  contDoc["saslContinue"] = vI32(1);
  contDoc["conversationId"] = vI32(convId);
  contDoc["payload"] = vBin(utf8Encode(finalClient), 0);
  reply = await runCommand(opts.authDb, contDoc);

  const finalBin = getVal(reply, "payload");
  let serverFinal = "";
  if (finalBin !== null && finalBin.kind === "binary") {
    serverFinal = utf8Decode(finalBin.v, finalBin.v.length);
  }
  const fin = parseKv(serverFinal);
  const serverKey = hmac(algo, salted, "Server Key");
  const expected = b64(hmac(algo, serverKey, authMessage));
  if (fin["v"] !== expected) {
    throw mongoError("AuthError", "server signature mismatch");
  }
  if (!getBool(reply, "done")) {
    const lastDoc: BsonDoc = {};
    lastDoc["saslContinue"] = vI32(1);
    lastDoc["conversationId"] = vI32(convId);
    lastDoc["payload"] = vBin(utf8Encode(""), 0);
    const last = await runCommand(opts.authDb, lastDoc);
    if (!getBool(last, "done")) {
      throw mongoError("AuthError", "server never finished SASL conversation");
    }
  }
}
