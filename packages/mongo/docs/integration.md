# Integration

`MongoClient.connect(opts)` opens one socket, runs `hello`, then SCRAM
if the URI carries credentials.

```ts
const client = await MongoClient.connect({
  uri: "mongodb://user:pass@host:27017/app?retryWrites=false",
  dbName: "app",
  appName: "my-service",        // shows up in mongod logs
  connectTimeoutMs: 10000,
  retryReads: true,             // one retry of reads on network error
  retryWrites: true,            // one retry of writes (never in a txn)
  tls: "preferred",             // "off" | "preferred" | "required"
});
```

## URI forms

- `mongodb://host[:port][,host2[:port2],...][/db][?opts]` — multi-seed
  parses, but v1 connects to the first seed only.
- `mongodb+srv://host[/db]` — forces TLS; the hostname is resolved via
  IPv4 `dns.lookup` (the subset's only DNS API — no SRV records), so a
  single A record must point at the cluster. Works for Atlas's
  single-record setups; multi-record SRV is v2.

URI options honored: `authSource`, `authMechanism`
(`SCRAM-SHA-1`/`SCRAM-SHA-256`, default 256), `tls`/`ssl`,
`tlsInsecure`/`tlsAllowInvalidCertificates` (skip cert verification),
`retryWrites` (informational — the ConnectOpts flag wins).

## Commands

Every public method lowers to an OP_MSG command document with `$db`
stamped. `db.command(spec)` is the raw passthrough — anything not in
the v1 surface (createIndexes, listCollections, drop, usersInfo) goes
through it.

## Errors

Server replies throw `MongoError` with the server's `code`/`codeName`;
`writeErrors[]` and `writeConcernError` surface the first entry.
Client-side failures use `code: -1` with named `codeName`s:
`NetworkError`, `ProtocolError`, `AuthError`, `BsonCorrupt`,
`Validation`, `CursorClosed`, `TransactionState`, `BadUri`.
