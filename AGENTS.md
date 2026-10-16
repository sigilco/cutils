# cutils AGENTS.md

cutils is the utility monorepo for the [chttp](https://github.com/sigilco/chttp)/scriptc ecosystem: `@cutils/*` packages for general-purpose utilities that own their own native dependency, and `@chttp/*` packages for request-scoped, web-server-concern utilities. Every package is authored in the scriptc-compilable subset so a consumer's `scriptc build` lowers the package with the app into a single static ELF.

## Commands

- `pnpm test` - all workspace tests
- `pnpm -r build` - build every package (tsc)
- `pnpm smoke:pack` - pack every package, install the tarballs into a fresh app, assert each resolves from its dist entry point
- `scripts/scriptc-gate.sh` - `scriptc coverage` 100% on every `packages/*/gate.ts` (run after `pnpm -r build`)
- `pnpm lint` - oxlint, `pnpm fmt` - oxfmt
- `pnpm docs:build` - build the docmd docs site into `docs/site`

## Releases

All `packages/*` publish at one shared version via pnpm native versioning (`versioning.fixed` in `pnpm-workspace.yaml`; `pnpm change check` guards drift in CI).

1. `pnpm change` per logical change, commit the intent file with the change.
2. At release: `pnpm version -r` (bumps the fixed group, consumes intents, writes CHANGELOGs), then `node scripts/changelog-root.mjs`, commit, tag `v<version>`.
3. Tag push triggers `.github/workflows/release.yml`: verifies every package.json matches the tag, publishes all packages behind the `npm-publish` environment approval.

Full procedure in [`RELEASING.md`](RELEASING.md), release notes in [`CHANGELOG.md`](CHANGELOG.md).

Publish and pack with pnpm only (`pnpm publish`, `pnpm pack`), never `npm publish` or `npm pack`. Internal ranges are `workspace:^` and only pnpm rewrites them to real semver ranges in the tarball; npm would ship the `workspace:` protocol and break installs.

## Scriptc subset rules (packages/*/src)

These are hard bans wherever a package ships in the subset (each package's AGENTS.md may add more). The shared rationale lives in `ARCHITECTURE.md`.

- `| null` unions only. Never `undefined` (SC3004) — the one documented exception is `@cutils/sqlite`'s `Stmt.get`, which ships `getOrNull` as the subset-strict twin.
- No `Map`/`Set`/`Object.create(null)`/`Object.freeze` unless a package's AGENTS.md documents a probe-verified exception (e.g. `@cutils/cache` uses `Map`, lifted by the 0.3.3 probe).
- Plain `({})` records with full shapes; no function values inside records (indices into parallel class-side arrays instead).
- Indexed `for` loops (and `for...of` over arrays). Never `for...in`. No recursion where a call could monomorphize `unknown`.
- No `?.` / `??`, no object or method shorthand in literals, no spread, no `eval`/`new Function`, no non-program `instanceof`.
- Concrete types on all tables and class fields; no `any`/`unknown[]`/`object`/`{[k]: unknown}` class fields — `unknown` may only appear in parameters, returns, locals, and plain-record members.
- Class generic parameters degrade instances to methodless shells on scriptc 0.3.x — narrow to non-generic core classes (`*Core`) with a type-level `interface X extends XCore` + `const X = XCore` alias when a generic-looking surface is needed.
- Union types of classes/records are the second poison: `A | B` where either is a class or a function-bearing record refuses. `T | null` is the only allowed union arm.

## Conventions

- Conventional commits, atomic commits (one logical change each).
- Plans live in `.agents/plans/<date>-<purpose>.md` and exist on disk before implementation (see `.agents/backlog-policy.md`).
- Any behavior change ships with tests; every package's test suite includes a `scriptc coverage` gate and an ELF smoke (`test/elf.test.sh`).
- Any performance claim requires a bench cell first; v1 packages ship without perf claims.
