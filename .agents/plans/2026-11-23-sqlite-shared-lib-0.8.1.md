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
  2. `prebuilt/<platform>-<arch>/libcutils_sqlite.{so,dylib,dll}`
  3. `build/libcutils_sqlite.{so,dylib,dll}` (`pnpm build:shared` output, or an existing consumer build such as coordinate's old script)
  4. compile `vendor/` with `$CC` (default `cc`) via `scripts/build-shared.sh`, into `<pkg>/build/` or, if that is read-only, a per-version tmp cache. It compiles to a temp name and renames, so concurrent first imports are safe. On win32 it uses `bash` (Git Bash) and POSIX paths instead of `sh`.
  5. otherwise throws an error naming `<platform>-<arch>`, the paths tried, and the two ways out (install a compiler, or set `CUTILS_SQLITE_LIB`). Platforms without a `libExt` mapping fail with an error naming the platform.
- `libExt`: linux→`so`, darwin→`dylib`, win32→`dll`. `PREBUILT_TARGETS` is linux-x64, linux-arm64, darwin-arm64, darwin-x64, win32-x64, win32-arm64.
- `scripts/build-shared.sh [abs-out] ` takes an output path and honors `$CC` (so `CC="cc -arch x86_64"` cross-builds the macOS x64 library on an arm64 runner, `CC="zig cc -target x86_64-windows-gnu"` a Windows DLL). The branch is picked by the OUTPUT EXTENSION: `*.dll` gets `-shared` with no `-fPIC`/`-Bsymbolic`/`-lm` (PE binds intra-DLL calls directly, so the ELF interposition bug cannot happen; mingw lld's import lib and PDB are pinned and deleted so only the DLL lands in `prebuilt/`); other outputs keep the ELF `-Wl,-Bsymbolic -shared` and Mach-O `-dynamiclib` branches. With no path on Windows (git-bash uname) the default output is `build/libcutils_sqlite.dll`.
- `scripts/build-prebuilt.mjs [--id <platform>-<arch>]` builds into `prebuilt/<id>/`, passing a package-relative path to the script (Windows paths do not survive sh argv) and using `bash` on win32. `prebuilt/` is gitignored, like `build/`; the `files` whitelist still packs it (verified, see below).
- `package.json`: `files` gains `node` and `prebuilt`; `exports["./node-binding"]` is now `./node/binding.mjs`; the `sed` is gone from `build`; new script `build:prebuilt`.
- Release workflow: `prebuilt` matrix — linux-x64 (ubuntu-22.04) and linux-arm64 (ubuntu-22.04-arm, same glibc 2.35 floor), darwin-arm64 and darwin-x64 (macos-15; x64 cross-built with `-arch x86_64`), win32-x64 (windows-2022, native load test) and win32-arm64 (windows-2022, cross-compiled by the x64 zig — zig 0.16.0's aarch64-windows binary segfaults on windows-11-arm — so no native load test for arm64). Windows DLLs are built with `zig cc 0.16.0 -target *-windows-gnu` (installed from ziglang.org, no MSVC needed; verified locally that all 34 `shim_*` symbols are exported). Every `native` runner also loads its library through koffi and runs FTS5 (`scripts/check-shared-lib.mjs`); only darwin-x64 and win32-arm64 skip the load check. `publish` now `needs: [verify, prebuilt]`, downloads the artifacts into `packages/sqlite/prebuilt/<id>/` and runs `scripts/assert-prebuilt.mjs` (fails if any target is missing or truncated) before `pnpm publish`. `workflow_dispatch` dry runs also exercise the matrix.
- ubuntu-22.04 instead of ubuntu-latest keeps the glibc floor at 2.35.

Why not something else: zig cross-compiling everything from one runner would be fewer jobs but replaces the toolchain the libraries are verified with, and native runners let the check script actually load each library. Not shipping prebuilts at all (compile-on-install) was the status quo that this fixes. No new runtime dependencies were added; koffi stays an optional peer.

Tarball size: one platform's library is 1.30 MB raw, about 0.72 MB gzipped (the Windows DLL is 1.46 MB raw). Six platforms land around 6.5-7 MB. Stripping saved only 4 percent, so it was not done.

Not done, follow-ups: musl/Alpine, win32-ia32, other BSDs. Those platforms use the compile fallback today.

## Commits (branch, oldest first)

```
23a2b9c fix(sqlite): node-binding resolves a shipped prebuilt library, compiling from vendor/ as fallback
cd5bc56 ci(sqlite): build per-platform shared libraries in release and pack them into the tarball
365bc53 docs(sqlite): document the prebuilt node-binding and its fallbacks
f63e6cd chore(sqlite): record change intent for the prebuilt node-binding
eeba407 style(sqlite): oxfmt the new node-binding scripts and tests
73efed5 chore(release): v0.8.1        <- tag v0.8.1 pointed here before the platform expansion
e841f43 feat(sqlite): resolve and build Windows and linux-arm64 node-binding libraries
afe56cf ci(sqlite): add linux-arm64 and win32-x64/arm64 to the prebuilt matrix
7f6d9cd docs(sqlite): cover linux-arm64 and windows in the 0.8.1 notes
569afa0 ci(sqlite): fix prebuilt runner labels found by the dry run
79f95b8 docs(plans): sqlite shared library 0.8.1 report
<squash-merged as bff9d80 via PR #59; this report update follows>
```

Release prep followed RELEASING.md: `pnpm change` intent, `pnpm version -r` (all six packages 0.8.0 to 0.8.1, also consumed the pending `famous-trains-tap` intent from #58), `node scripts/changelog-root.mjs` (root entry edited for voice, re-run keeps it), `pnpm change check` passes, local tag `v0.8.1`. No co-author trailers, per the repo rules.

## Verified locally (darwin-arm64, Node 24.22.3 for the test runs)

- `pnpm -r build`: ok.
- `pnpm test`: ok, rc 0. sqlite: 31 tests, 31 pass (17 in `test/resolve-lib.test.mjs`, incl. win32→`.dll` cases), `elf.test.sh OK`, `consumer-elf.test.sh OK`. cache 25/25, cli 93/93, ffi 5/5, mongo 21 pass (3 skipped), postgres 29 pass (1 skipped).
- `pnpm smoke:pack`: ok in the release `verify` job on the merged code (the local re-run stayed queued behind `/tmp/tsc.lock` and was dropped; the earlier local run passed). It builds the host prebuilt, packs every package, installs the tarballs, installs koffi, imports `@cutils/sqlite/node-binding`, opens an in-memory db, creates an FTS5 table and queries it, asserts `librarySource === "prebuilt"`. It then deletes `prebuilt/` and runs the same program again, asserting `librarySource === "compiled"` (fallback compiles from vendor/ inside the installed package). Both print `sqlite node-binding OK`, final `pack-smoke OK`.
- `bash scripts/check-packed.sh`: ok (6 tarballs, no `workspace:` ranges). `pnpm lint`: ok. `pnpm change check`: ok.
- Tarball contents checked: `package/prebuilt/darwin-arm64/libcutils_sqlite.dylib`, `package/node/binding.mjs`, `package/node/resolve-lib.mjs`, `package/scripts/build-shared.sh` are present even though `prebuilt/` is gitignored.
- No-compiler error text checked by hand (names `darwin-arm64`, lists tried paths, mentions `CUTILS_SQLITE_LIB`).
- darwin-x64: `CC="cc -arch x86_64" sh scripts/build-shared.sh` produces a Mach-O x86_64 dylib here (not loaded, there is no x64 runtime on this machine).
- Windows DLLs, built locally with zig 0.16.0 (same version CI pins): `zig cc -target x86_64-windows-gnu` and `-target aarch64-windows-gnu` each produce a PE32+ DLL in ~21 s; `objdump -p` shows all 34 `shim_*` exports. `node scripts/build-prebuilt.mjs --id win32-x64` with `CC="zig cc -target x86_64-windows-gnu"` produces a clean `prebuilt/win32-x64/libcutils_sqlite.dll` (1.46 MB) — the mingw PDB and import lib are deleted by `build-shared.sh`. Not load-tested locally (no Windows).

Environment notes (none are repo changes):

- The default Node on this machine is 26, which has no corepack, so the existing `consumer-elf.test.sh` (`corepack pnpm pack`) fails there. Tests and smoke ran under `mise exec node@24`.
- scriptc's toolchain files needed the exec bit (`find node_modules/.pnpm -path '*@scriptc+cli-*/dist/lib/*' -type f -exec chmod +x {} +`, the same step CI has).
- `scripts/scriptc-gate.sh` dies on macOS bash 3.2 (`ffi_args[@]: unbound variable`, pre-existing). The sqlite `coverage.test.mjs` gate ran and passed inside `pnpm test`; no subset code changed (one comment in `src/internal/ffi.ts`).
- `pnpm fmt:check` still reports `packages/cli/src/index.ts`, `scripts/build-shim.mjs`, `test/build-shim.test.mjs`. They are untouched by this branch and were already unformatted.

## Release outcome (done)

PR #59 squash-merged as `bff9d80`; tag `v0.8.1` re-created on the merge commit and pushed. A `workflow_dispatch` dry run first caught two CI-only issues, both fixed in `569afa0`: `macos-14` is retired (`macos-14-arm64-us-default is not supported` → `macos-15`), and zig 0.16.0's `aarch64-windows` binary segfaults on `windows-11-arm` (win32-arm64 now cross-compiled by the x64 zig on windows-2022, `native: false`). The tag run https://github.com/sigilco/cutils/actions/runs/45274831703 went green on `verify` + all six `prebuilt` jobs; the owner approved `npm-publish`; `publish` and `github-release` succeeded. All six packages published at 0.8.1 (`published: @cutils/cache @cutils/cli @cutils/ffi @cutils/mongo @cutils/postgres @cutils/sqlite`, none failed). The published `@cutils/sqlite@0.8.1` tarball on npm contains `prebuilt/{linux-x64,linux-arm64,darwin-arm64,darwin-x64,win32-x64,win32-arm64}/libcutils_sqlite.*` plus `node/binding.mjs` — verified with `npm pack` + `tar -tzf`.

Still only verifiable outside CI: the darwin-x64 library loading on an Intel Mac, and win32-arm64 loading on Windows on ARM (compile-verified only). Everything else — linux x64/arm64, darwin arm64, win32 x64 — is load-tested in CI.

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

The tag push starts `release` run "v0.8.1". Jobs: `verify` (green), six `prebuilt` jobs (linux-x64, linux-arm64, darwin-arm64, darwin-x64, win32-x64, win32-arm64 — green), then `publish` waits on "Review deployments" for the `npm-publish` environment. Approving publishes, in directory order, `@cutils/cache`, `@cutils/cli`, `@cutils/ffi`, `@cutils/mongo`, `@cutils/postgres`, `@cutils/sqlite`, all at 0.8.1, skipping any version already on npm. The `@cutils/sqlite` tarball will contain `prebuilt/{linux-x64,linux-arm64,darwin-arm64,darwin-x64,win32-x64,win32-arm64}`. If any `prebuilt` job fails, `publish` never starts waiting. Approval and rejection are yours; nothing here touched them.

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
