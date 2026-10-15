# cutils

TypeScript utility packages for [chttp](https://github.com/sigilco/chttp) apps, authored in the [scriptc](https://github.com/vercel-labs/scriptc)-compilable subset so the same source compiles to a single native ELF with `scriptc build`.

The repo carries two scopes:

- **`@cutils/*`** — general-purpose utilities that own their own native dependency (SQLite today; the DB family shape).
- **`@chttp/*`** — request-scoped utilities that are a web-server concern (cache, MCP).

Every package follows the same contract: zero runtime dependencies, the Standard-Schema seam for user-typed data, `scriptc coverage` at 100% on its gate entry, and an end-to-end ELF smoke in its test suite.
