# Authentication

`Database.connect` runs the Postgres auth loop until `AuthenticationOk`,
then drains `ParameterStatus`/`BackendKeyData` to the first
`ReadyForQuery`.

## Mechanisms

| Server request                        | Driver reply                       |
| ------------------------------------- | ---------------------------------- |
| `AuthenticationOk` (trust)            | none — straight through            |
| `AuthenticationCleartextPassword` (3) | cleartext password                 |
| `AuthenticationMD5Password` (5)       | `md5(md5(password + user) + salt)` |
| `AuthenticationSASL` (10)             | `SCRAM-SHA-256` only               |

Anything else (`GSS`, `SSPI`, `SASL-PLUS`, `SCRAM-SHA-256-PLUS`, `SASL`
without `SCRAM-SHA-256` in the mechanism list, cert auth) throws
`PgError("28000")`.

## SCRAM-SHA-256

RFC 5802 / RFC 7677, on `node:crypto` only:

- `pbkdf2Sync(password, salt, iterations, 32, "sha256")` for `Hi()`;
- `createHmac`/`createHash` for `ClientKey`/`StoredKey`/`ServerKey`;
- `randomBytes(18)` client nonce, base64-encoded;
- `timingSafeEqual` for the server signature check.

Checks the server nonce carries the client nonce as a prefix (downgrade
protection) and verifies `v=` against the computed `ServerSignature` —
mismatches throw `PgError("28000")`. Channel binding is `n,,` (no
`SCRAM-SHA-256-PLUS`): TLS is required for channel binding and TLS is not
available in v1. The RFC 7677 example exchange is a unit-test vector
(`test/scram.test.js`).

Usernames are SASL-escaped (`=` → `=3D`, `,` → `=2C`) inside the message
but sent verbatim in the StartupMessage — Postgres uses the startup user
for authorization, `n=` is informational.

## Limits

- Passwords go over the wire per the negotiated mechanism — without TLS,
  cleartext auth exposes them to the network (deploy accordingly).
- `password` is required by the type (`ConnectOpts.password`); trust- and
  peer-authenticated servers still accept the sent value.
- There is no credential caching: each `connect()` authenticates fresh.
