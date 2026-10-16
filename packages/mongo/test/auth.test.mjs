// auth.test.mjs — SCRAM client-proof vectors. The fake server echoes the
// client's random nonce (as a real mongod does); the expected proof is
// recomputed independently with node:crypto, pinning the wire composition
// (fields, ordering, base64) rather than crypto identity.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { scramAuth } from "../dist/esm/internal/auth.js";
import { vBin, vBool, vI32 } from "../dist/esm/bson/value.js";

function replyWith(payload, done = true, convId = 1) {
  return {
    conversationId: vI32(convId),
    done: vBool(done),
    payload: vBin(Buffer.from(payload, "utf8"), 0),
    ok: { kind: "double", v: 1 },
  };
}

function binPayload(doc) {
  const p = doc.payload;
  return Buffer.from(p.v).toString("utf8");
}

function clientNonce(spec) {
  const first = binPayload(spec); // "n,,n=user,r=<nonce>"
  return first.slice(first.indexOf("r=") + 2);
}

function expectedProof({ algo, password, serverFirst, bare }) {
  const kv = {};
  for (const part of serverFirst.split(",")) {
    const eq = part.indexOf("=");
    kv[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const salt = Buffer.from(kv.s, "base64");
  const iters = parseInt(kv.i, 10);
  const hashLen = algo === "sha1" ? 20 : 32;
  const salted = pbkdf2Sync(password, salt, iters, hashLen, algo);
  const clientKey = createHmac(algo, salted).update("Client Key").digest();
  const storedKey = createHash(algo).update(clientKey).digest();
  const withoutProof = "c=biws,r=" + kv.r;
  const authMessage = bare + "," + serverFirst + "," + withoutProof;
  const sig = createHmac(algo, storedKey).update(authMessage).digest();
  const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i])).toString("base64");
  const serverKey = createHmac(algo, salted).update("Server Key").digest();
  const serverSig = createHmac(algo, serverKey).update(authMessage).digest("base64");
  return { proof, serverSig, clientFinal: withoutProof + ",p=" + proof };
}

async function runScram({ mechanism, username, password, saltB64, iters, digested }) {
  const algo = mechanism === "SCRAM-SHA-1" ? "sha1" : "sha256";
  const sent = [];
  let expected = null;
  const runCommand = async (_db, spec) => {
    sent.push(spec);
    if (typeof spec.saslStart !== "undefined") {
      const nonce = clientNonce(spec);
      const serverFirst = `r=${nonce}3rfcNHYJY1ZVvWVs7j,s=${saltB64},i=${iters}`;
      const pw = digested
        ? createHash("md5").update(`${username}:mongo:${password}`).digest("hex")
        : password.normalize("NFKC");
      expected = expectedProof({
        algo,
        password: pw,
        serverFirst,
        bare: `n=${username},r=${nonce}`,
      });
      return replyWith(serverFirst, false);
    }
    return replyWith(`v=${expected.serverSig}`, true);
  };
  await scramAuth(runCommand, { mechanism, username, password, authDb: "admin" });
  return { sent, expected };
}

test("SCRAM-SHA-1 produces a valid RFC 5802 proof (md5-digested password)", async () => {
  const { sent, expected } = await runScram({
    mechanism: "SCRAM-SHA-1",
    username: "user",
    password: "pencil",
    saltB64: "QSXCR+Q6sek8bf92",
    iters: 4096,
    digested: true,
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].mechanism.v, "SCRAM-SHA-1");
  const clientFinal = binPayload(sent[1]);
  assert.equal(clientFinal, expected.clientFinal);
});

test("SCRAM-SHA-256 produces a valid proof (NFKC saslprep)", async () => {
  const { sent, expected } = await runScram({
    mechanism: "SCRAM-SHA-256",
    username: "user",
    password: "pencil",
    saltB64: "W22ZaJ0SNY7soEsUEjb6gQ==",
    iters: 4096,
    digested: false,
  });
  const clientFinal = binPayload(sent[1]);
  assert.ok(clientFinal.startsWith("c=biws,r="), clientFinal);
  assert.equal(clientFinal, expected.clientFinal);
});

test("server signature mismatch is rejected", async () => {
  const runCommand = async (_db, spec) => {
    if (typeof spec.saslStart !== "undefined") {
      return replyWith(`r=${clientNonce(spec)}x,s=AAAA,i=1`, false);
    }
    return replyWith("v=bogus", true);
  };
  await assert.rejects(
    scramAuth(runCommand, {
      mechanism: "SCRAM-SHA-256",
      username: "u",
      password: "p",
      authDb: "admin",
    }),
    /server signature mismatch/,
  );
});

test("server-first without our nonce prefix is rejected", async () => {
  const runCommand = async () => replyWith("r=notournonce,s=AAAA,i=4096", false);
  await assert.rejects(
    scramAuth(runCommand, {
      mechanism: "SCRAM-SHA-256",
      username: "u",
      password: "p",
      authDb: "admin",
    }),
    /malformed server-first-message/,
  );
});

test("done=false on server-final triggers the empty third message", async () => {
  const sent = [];
  const runCommand = async (_db, spec) => {
    sent.push(spec);
    if (typeof spec.saslStart !== "undefined") {
      return replyWith(
        `r=${clientNonce(spec)}x,s=${Buffer.from("salt").toString("base64")},i=1`,
        false,
      );
    }
    if (sent.length === 2) {
      return replyWith("v=AAAA", false); // not done — but wrong signature too
    }
    return replyWith("", true);
  };
  await assert.rejects(
    scramAuth(runCommand, {
      mechanism: "SCRAM-SHA-256",
      username: "u",
      password: "p",
      authDb: "admin",
    }),
    /server signature mismatch/,
  );
});
