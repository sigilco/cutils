// SCRAM-SHA-256 tests — RFC 7677 example exchange as the canonical vector
// (user "user", password "pencil"), plus structure checks on each message.

import test from "node:test";
import assert from "node:assert/strict";

const { Scram } = await import("../dist/esm/internal/auth.js");

// RFC 7677 example values.
const USER = "user";
const PASSWORD = "pencil";
const CLIENT_NONCE = "rOprNGfwEbeRWgbNEkqO";
const SERVER_FIRST =
  "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
const EXPECTED_FINAL =
  "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=";
const SERVER_FINAL = "v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=";

test("scram: RFC 7677 vector — client-first, proof, server verify", () => {
  const scram = new Scram(USER, PASSWORD);
  scram._state = { clientNonce: CLIENT_NONCE, clientFirstBare: `n=${USER},r=${CLIENT_NONCE}` };
  const finalBytes = scram.serverFirst(SERVER_FIRST);
  const final = new TextDecoder().decode(finalBytes);
  assert.equal(final, EXPECTED_FINAL);
  scram.serverFinal(SERVER_FINAL);
});

test("scram: initial response shape + nonce plumbing", () => {
  const scram = new Scram(USER, PASSWORD);
  const init = new TextDecoder().decode(scram.initialResponse());
  assert.ok(init.startsWith("n,,n=user,r="));
  assert.equal(init.length, "n,,n=user,r=".length + 24); // b64(18 bytes) = 24
  assert.equal(scram.mechanism(), "SCRAM-SHA-256");
});

test("scram: escaped username", () => {
  const scram = new Scram("a=b,c", PASSWORD);
  scram._state = null;
  const init = new TextDecoder().decode(scram.initialResponse());
  assert.ok(init.startsWith("n,,n=a=3Db=2Cc,r="));
});

test("scram: server nonce mismatch throws", () => {
  const scram = new Scram(USER, PASSWORD);
  scram._state = { clientNonce: "AAAA", clientFirstBare: "n=user,r=AAAA" };
  assert.throws(() => scram.serverFirst(SERVER_FIRST), /nonce mismatch/);
});

test("scram: bad server signature throws", () => {
  const scram = new Scram(USER, PASSWORD);
  scram._state = { clientNonce: CLIENT_NONCE, clientFirstBare: `n=${USER},r=${CLIENT_NONCE}` };
  scram.serverFirst(SERVER_FIRST);
  assert.throws(
    () => scram.serverFinal("v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    /signature mismatch/,
  );
});

test("scram: server error in final message throws", () => {
  const scram = new Scram(USER, PASSWORD);
  scram._state = { clientNonce: CLIENT_NONCE, clientFirstBare: `n=${USER},r=${CLIENT_NONCE}` };
  scram.serverFirst(SERVER_FIRST);
  assert.throws(() => scram.serverFinal("e=invalid-proof"), /server error/);
});
