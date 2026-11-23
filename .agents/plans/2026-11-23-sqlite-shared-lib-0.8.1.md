# @cutils/sqlite 0.8.1: ship the Node shared library, 2026-11-23

Classification: bug. Effort: M. Branch `fix/sqlite-shared-lib-0.8.1`, local tag `v0.8.1` (not pushed).

## Problem

`@cutils/sqlite` 0.8.0 ships the C sources and `build/libsqlite3-shim.a` (scriptc path), but its Node entry `@cutils/sqlite/node-binding` loads `build/libcutils_sqlite.so` through koffi and that file is not in the tarball. `await import("@cutils/sqlite/node-binding")` in an installed consumer throws `Failed to load shared library: ... (no such file)`. The `coordinate` repo worked around it with its own `scripts/build-sqlite-shared.sh` run inside `node_modules`.

Reproduced with the control run below (0.8.0 from the registry, no build script: 2 failures, 0 passes).

## Design

Preferred design from the brief, kept as is: per-platform prebuilt libraries in the tarball, resolved at import time, with a compile fallback.

- `node/binding.mjs` (was `test/koffi-binding.mjs`, previously copied into `dist/esm/node-binding.mjs` by a `sed` in the build script). It is now plain JS shipped as is, exported as `./node-binding`. Same koffi adapters, but the library path comes from `resolveLib`. It also exports `libraryPath` and `librarySource`, and a missing `koffi` gives a clear message.
- `node/resolve-lib.mjs`, resolution order:
  1. `$CUTILS_SQLITE_LIB` (explicit override, must exist)
  2. `prebuilt/<platform>-<arch>/libcutils_sqlite.{so,dylib}`
  3. `build/libcutils_sqlite.so` (`pnpm build:shared` output, or an existing consumer build such as coordinate's old script)
  4. compile `vendor/` with `$CC` (default `cc`) via `scripts/build-shared.sh`, into `<pkg>/build/` or, if that is read-only, a per-version tmp cache. It compiles to a temp name and renames, so concurrent first imports are safe.
  5. otherwise throws an error naming `<platform>-<arch>`, the paths tried, and the two ways out (install a compiler, or set `CUTILS_SQLITE_LIB`). Windows and other platforms fail with an error naming the platform.
- `scripts/build-shared.sh [abs-out] ` takes an output path and honors `$CC` (so `CC="cc -arch x86_64"` cross-builds the macOS x64 library on an arm64 runner). The Linux `-Wl,-Bsymbolic -shared` and Mach-O `-dynamiclib` branches are unchanged.
- `scripts/build-prebuilt.mjs [--id <platform>-<arch>]` builds into `prebuilt/<id>/`. `prebuilt/` is gitignored, like `build/`; the `files` whitelist still packs it (verified, see below).
- `package.json`: `files` gains `node` and `prebuilt`; `exports["./node-binding"]` is now `./node/binding.mjs`; the `sed` is gone from `build`; new script `build:prebuilt`.
- Release workflow: new `prebuilt` matrix job (ubuntu-22.04 linux-x64, macos-14 darwin-arm64, macos-14 darwin-x64 cross-built with `-arch x86_64`), no secrets, runs in parallel with `verify`. Each job asserts the architecture with `file`, and native ones also load the library through koffi and run FTS5 (`scripts/check-shared-lib.mjs`). `publish` now `needs: [verify, prebuilt]`, downloads the artifacts into `packages/sqlite/prebuilt/<id>/` and runs `scripts/assert-prebuilt.mjs` (fails if any target is missing or truncated) before `pnpm publish`. `workflow_dispatch` dry runs also exercise the matrix.
- ubuntu-22.04 instead of ubuntu-latest keeps the glibc floor at 2.35.

Why not something else: zig cross-compiling everything from one runner would be fewer jobs but replaces the toolchain the libraries are verified with, and native runners let the check script actually load each library. Not shipping prebuilts at all (compile-on-install) was the status quo that this fixes. No new runtime dependencies were added; koffi stays an optional peer.

Tarball size: one platform's library is 1.30 MB raw, about 0.72 MB gzipped. The local tarball with the host prebuilt is 4.18 MB, so three platforms land around 5.6 MB. Stripping saved only 4 percent, so it was not done.

Not done, follow-ups: linux-arm64 (`ubuntu-24.04-arm` is a one-line matrix entry), musl/Alpine, Windows. Those platforms use the compile fallback today.

## Commits (branch, oldest first)

```
23a2b9c fix(sqlite): node-binding resolves a shipped prebuilt library, compiling from vendor/ as fallback
cd5bc56 ci(sqlite): build per-platform shared libraries in release and pack them into the tarball
365bc53 docs(sqlite): document the prebuilt node-binding and its fallbacks
f63e6cd chore(sqlite): record change intent for the prebuilt node-binding
eeba407 style(sqlite): oxfmt the new node-binding scripts and tests
73efed5 chore(release): v0.8.1        <- tag v0.8.1 points here
<this plan file>                       <- committed after the tag
```

Release prep followed RELEASING.md: `pnpm change` intent, `pnpm version -r` (all six packages 0.8.0 to 0.8.1, also consumed the pending `famous-trains-tap` intent from #58), `node scripts/changelog-root.mjs` (root entry edited for voice, re-run keeps it), `pnpm change check` passes, local tag `v0.8.1`. No co-author trailers, per the repo rules.

## Verified locally (darwin-arm64, Node 24.22.3 for the test runs)

- `pnpm -r build`: ok.
- `pnpm test`: ok, rc 0. sqlite: 28 tests, 28 pass (14 new in `test/resolve-lib.test.mjs`), `elf.test.sh OK`, `consumer-elf.test.sh OK`. cache 25/25, cli 93/93, ffi 5/5, mongo 21 pass (3 skipped), postgres 29 pass (1 skipped).
- `pnpm smoke:pack`: ok. It builds the host prebuilt, packs every package, installs the tarballs, installs koffi, imports `@cutils/sqlite/node-binding`, opens an in-memory db, creates an FTS5 table and queries it, asserts `librarySource === "prebuilt"`. It then deletes `prebuilt/` and runs the same program again, asserting `librarySource === "compiled"` (fallback compiles from vendor/ inside the installed package). Both print `sqlite node-binding OK`, final `pack-smoke OK`.
- `bash scripts/check-packed.sh`: ok (6 tarballs, no `workspace:` ranges). `pnpm lint`: ok. `pnpm change check`: ok.
- Tarball contents checked: `package/prebuilt/darwin-arm64/libcutils_sqlite.dylib`, `package/node/binding.mjs`, `package/node/resolve-lib.mjs`, `package/scripts/build-shared.sh` are present even though `prebuilt/` is gitignored.
- No-compiler error text checked by hand (names `darwin-arm64`, lists tried paths, mentions `CUTILS_SQLITE_LIB`).
- darwin-x64: `CC="cc -arch x86_64" sh scripts/build-shared.sh` produces a Mach-O x86_64 dylib here (not loaded, there is no x64 runtime on this machine).

Environment notes (none are repo changes):

- The default Node on this machine is 26, which has no corepack, so the existing `consumer-elf.test.sh` (`corepack pnpm pack`) fails there. Tests and smoke ran under `mise exec node@24`.
- scriptc's toolchain files needed the exec bit (`find node_modules/.pnpm -path '*@scriptc+cli-*/dist/lib/*' -type f -exec chmod +x {} +`, the same step CI has).
- `scripts/scriptc-gate.sh` dies on macOS bash 3.2 (`ffi_args[@]: unbound variable`, pre-existing). The sqlite `coverage.test.mjs` gate ran and passed inside `pnpm test`; no subset code changed (one comment in `src/internal/ffi.ts`).
- `pnpm fmt:check` still reports `packages/cli/src/index.ts`, `scripts/build-shim.mjs`, `test/build-shim.test.mjs`. They are untouched by this branch and were already unformatted.

## Only verifiable in CI

- The linux-x64 build on ubuntu-22.04 and its `check-shared-lib.mjs` run (I could only build on macOS). The Linux branch of `build-shared.sh` is unchanged apart from `$CC` and the output path.
- The darwin-x64 library actually loading on an Intel Mac (CI only checks it is x86_64, as there is no native Intel runner in the matrix). Run `node scripts/check-shared-lib.mjs <file>` on an Intel Mac if you want certainty.
- The artifact upload/download layout and the assemble step in `publish` (`prebuilt-<id>/libcutils_sqlite.*` copied to `packages/sqlite/prebuilt/<id>/`), and `assert-prebuilt`. A `workflow_dispatch` dry run exercises the matrix but not `publish` (it is skipped for dispatch), so the assemble step is first exercised by the real tag run, behind the approval. If you want it exercised earlier, temporarily allow the dispatch event for the download and assert steps in a throwaway run.
- `pnpm install --frozen-lockfile --filter @cutils/sqlite` on the matrix runners, and `macos-14` still being arm64.

## Push and release (you run these)

Previous releases were squash-merged (`chore(release): v0.8.0 (#57)`), so the local tag will not match the merge commit. Merge first, then tag main.

```sh
git push -u origin fix/sqlite-shared-lib-0.8.1
gh pr create --base main --head fix/sqlite-shared-lib-0.8.1 --title "fix(sqlite): ship prebuilt shared libraries for node-binding (0.8.1)" --body-file <your body>

# optional dry run of verify + the prebuilt matrix on the branch (never publishes):
gh workflow run release.yml --ref fix/sqlite-shared-lib-0.8.1 -f tag=v0.8.1

# after the PR is merged:
git fetch origin && git checkout main && git pull --ff-only
git tag -d v0.8.1                 # drop the local branch-commit tag
git tag v0.8.1 origin/main        # or the merge commit, it must carry version 0.8.1
git push origin v0.8.1
```

If the PR is merged with a merge commit or rebase and you prefer the existing tag, `git push origin v0.8.1` works as is only when the tagged commit is on main; otherwise retag as above. `release.yml` fails `verify` if any `package.json` differs from the tag.

## What the `npm-publish` approval will show

The tag push starts `release` run "v0.8.1". Jobs: `verify` (green), `prebuilt linux-x64`, `prebuilt darwin-arm64`, `prebuilt darwin-x64` (green), then `publish` waits on "Review deployments" for the `npm-publish` environment. Approving publishes, in directory order, `@cutils/cache`, `@cutils/cli`, `@cutils/ffi`, `@cutils/mongo`, `@cutils/postgres`, `@cutils/sqlite`, all at 0.8.1, skipping any version already on npm. The `@cutils/sqlite` tarball will contain `prebuilt/{linux-x64,darwin-arm64,darwin-x64}`. If any `prebuilt` job fails, `publish` never starts waiting. Approval and rejection are yours; nothing here touched them.

## Consumer check (coordinate)

Read-only reference `/Users/josocjoq/Documents/prjcts/_own/coordinate` was copied with rsync (no `node_modules`, no `.git`) to a temp dir. In the copy: `@cutils/sqlite` pointed at the packed 0.8.1 tarball (`file:` dependency), `scripts/build-sqlite-shared.sh` deleted, and `package.json` `test` changed from `sh scripts/build-sqlite-shared.sh && node --test` to `node --test`.

```
pnpm install --no-frozen-lockfile     # installs @cutils/sqlite 0.8.1 from the tarball
node --test
  ℹ tests 15  ℹ pass 15  ℹ fail 0
ls node_modules/@cutils/sqlite/build   # libsqlite3-shim.a only: no libcutils_sqlite.so was built
```

The tests load `@cutils/sqlite/node-binding` from `prebuilt/darwin-arm64/` (no `build/libcutils_sqlite.so` exists). Control, same copy with `@cutils/sqlite@0.8.0` from the registry and no build script: `Failed to load shared library: ... build/libcutils_sqlite.so (no such file)`, 0 pass, 2 fail.

Note for coordinate after 0.8.1 is published: bump `@cutils/sqlite`, delete `scripts/build-sqlite-shared.sh`, drop it from `test` and from `scripts/README.md`. An existing `build/libcutils_sqlite.so` from the old script stays valid (tier 3), but the prebuilt now takes precedence over it.
