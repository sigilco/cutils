<h1 align="center">cutils</h1>
<p align="center">TypeScript utilities for chttp apps, authored in the scriptc-compilable subset and shipped as packages that compile to native ELF binaries.</p>
<p align="center">
  <a href="https://github.com/sigilco/cutils/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://github.com/sigilco/cutils/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sigilco/cutils/actions/workflows/ci.yml/badge.svg"></a>
</p>

## Packages

| Package | What it does |
| --- | --- |
| [`@cutils/sqlite`](packages/sqlite) | Embedded SQLite: `Database`/`Stmt`/`Transaction` with a Standard-Schema row seam, vendored amalgamation + C shim, compiles into the ELF |
| [`@cutils/postgres`](packages/postgres) | Postgres wire driver over `node:net` + `node:crypto` (SCRAM-SHA-256, txns, LISTEN/NOTIFY), no FFI |
| [`@cutils/mongo`](packages/mongo) | MongoDB wire driver (OP_MSG + BSON, SCRAM-SHA-1/256, txns), no FFI |
| [`@cutils/cache`](packages/cache) | LRU + TTL in-process cache with lru-cache parity semantics |

## What it does

- Ships `@cutils/*` and `@chttp/*` packages whose sources stay inside the scriptc subset, so `scriptc build` lowers your app — utilities included — into one static binary.
- Uses the Standard-Schema seam (`schema["~standard"].validate`) wherever a package needs user-typed data: `@chttp/val`, valibot, or any conforming validator plugs in.
- Zero runtime dependencies per package; the docs site, tests, and CI mirror the [chttp](https://github.com/sigilco/chttp) monorepo setup.

## Development

```sh
pnpm install
pnpm -r build
pnpm -r test
pnpm docs:build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change-intent workflow and [RELEASING.md](RELEASING.md) for the release process.
