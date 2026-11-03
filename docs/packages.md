# Packages

| Package | Scope | What it does |
| --- | --- | --- |
| [`@cutils/ffi`](https://www.npmjs.com/package/@cutils/ffi) | cutils | Shared scriptc format-7 FFI spec (sqlite's span ABI) + Rust `EchoPoint` echo |
| [`@cutils/sqlite`](https://www.npmjs.com/package/@cutils/sqlite) | cutils | Embedded SQLite: `Database`/`Stmt`/`Transaction`, Standard-Schema row seam, vendored amalgamation + C shim |
| [`@cutils/postgres`](https://www.npmjs.com/package/@cutils/postgres) | cutils | Postgres wire driver over `node:net` + `node:crypto` (SCRAM-SHA-256, txns, LISTEN/NOTIFY), no FFI |
| [`@cutils/mongo`](https://www.npmjs.com/package/@cutils/mongo) | cutils | MongoDB wire driver (OP_MSG + BSON, SCRAM-SHA-1/256, txns), no FFI |
| [`@cutils/cache`](https://www.npmjs.com/package/@cutils/cache) | chttp | LRU + TTL in-process cache with lru-cache parity semantics |

`@chttp/auth` and `@chttp/mcp` moved to the [chttp](https://github.com/sigilco/chttp) monorepo — new releases publish from there.

Design plans for each package live in `.agents/plans/` at the repo root.
