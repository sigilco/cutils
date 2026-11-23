// node/resolve-lib.mjs: platform -> shared library resolution, with every fs
// and process side effect injected.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  ENV_OVERRIDE,
  libExt,
  localBuildPath,
  prebuiltPath,
  PREBUILT_TARGETS,
  resolveLib,
  targetId,
} from "../node/resolve-lib.mjs";

const ROOT = "/pkg";
const base = (over) => ({
  pkgRoot: ROOT,
  platform: "linux",
  arch: "x64",
  env: {},
  exists: () => false,
  canWrite: () => true,
  hasCompiler: () => true,
  compile: () => {
    throw new Error("compile not stubbed");
  },
  tmp: "/tmp",
  version: "9.9.9",
  ...over,
});

test("platform names map to library extensions", () => {
  assert.equal(libExt("linux"), "so");
  assert.equal(libExt("darwin"), "dylib");
  assert.equal(libExt("win32"), null);
  assert.equal(libExt("freebsd"), null);
});

test("prebuilt layout is prebuilt/<platform>-<arch>/libcutils_sqlite.<ext>", () => {
  assert.equal(
    prebuiltPath(ROOT, "linux", "x64"),
    join(ROOT, "prebuilt/linux-x64/libcutils_sqlite.so"),
  );
  assert.equal(
    prebuiltPath(ROOT, "darwin", "arm64"),
    join(ROOT, "prebuilt/darwin-arm64/libcutils_sqlite.dylib"),
  );
  assert.equal(prebuiltPath(ROOT, "win32", "x64"), null);
  assert.deepEqual(PREBUILT_TARGETS, ["linux-x64", "darwin-arm64", "darwin-x64"]);
  assert.equal(targetId("darwin", "x64"), "darwin-x64");
});

for (const [platform, arch] of [
  ["linux", "x64"],
  ["darwin", "arm64"],
  ["darwin", "x64"],
]) {
  test(`${platform}-${arch}: picks its own prebuilt, never another platform's`, () => {
    const want = prebuiltPath(ROOT, platform, arch);
    const r = resolveLib(base({ platform, arch, exists: (p) => p === want }));
    assert.deepEqual(r, { path: want, source: "prebuilt" });
    // a different platform's file must not satisfy this one
    const other = prebuiltPath(ROOT, platform === "linux" ? "darwin" : "linux", "arm64");
    assert.throws(
      () =>
        resolveLib(
          base({ platform, arch, exists: (p) => p === other, hasCompiler: () => false }),
        ),
      /no prebuilt library for/,
    );
  });
}

test("env override wins over a prebuilt and must exist", () => {
  const env = { [ENV_OVERRIDE]: "/custom/lib.so" };
  const r = resolveLib(base({ env, exists: () => true }));
  assert.deepEqual(r, { path: "/custom/lib.so", source: "env" });
  assert.throws(() => resolveLib(base({ env })), /CUTILS_SQLITE_LIB=\/custom\/lib\.so does not exist/);
});

test("falls back to the in-package build/ output before compiling", () => {
  const local = localBuildPath(ROOT);
  const r = resolveLib(
    base({
      exists: (p) => p === local,
      compile: () => assert.fail("must not compile"),
    }),
  );
  assert.deepEqual(r, { path: local, source: "local-build" });
});

test("compiles from vendor/ into <pkg>/build when no library exists", () => {
  const calls = [];
  const made = new Set();
  const r = resolveLib(
    base({
      exists: (p) => made.has(p),
      compile: (root, cc, out) => {
        calls.push([root, cc, out]);
        made.add(out);
      },
    }),
  );
  assert.equal(r.source, "compiled");
  assert.equal(r.path, join(ROOT, "build/libcutils_sqlite.so"));
  assert.deepEqual(calls, [[ROOT, "cc", r.path]]);
});

test("honors $CC and reuses an earlier compiled copy", () => {
  const out = join(ROOT, "build/libcutils_sqlite.so");
  // the local-build step already finds a previously compiled copy
  assert.equal(resolveLib(base({ exists: (p) => p === out })).source, "local-build");
  const calls = [];
  resolveLib(
    base({
      env: { CC: "zig cc" },
      compile: (_r, cc) => calls.push(cc),
    }),
  );
  assert.deepEqual(calls, ["zig cc"]);
});

test("read-only package dir falls back to a per-version tmp cache", () => {
  const cache = join("/tmp", "cutils-sqlite-9.9.9-linux-x64");
  const calls = [];
  const r = resolveLib(
    base({
      canWrite: (d) => d === cache,
      compile: (_r, _cc, out) => calls.push(out),
    }),
  );
  assert.equal(r.path, join(cache, "libcutils_sqlite.so"));
  assert.equal(r.source, "compiled");
  assert.deepEqual(calls, [r.path]);
});

test("no prebuilt and no compiler: error names platform, arch and the escape hatch", () => {
  assert.throws(
    () => resolveLib(base({ platform: "darwin", arch: "arm64", hasCompiler: () => false })),
    (e) =>
      /no prebuilt library for darwin-arm64/.test(e.message) &&
      /no C compiler \(cc\)/.test(e.message) &&
      e.message.includes(prebuiltPath(ROOT, "darwin", "arm64")) &&
      e.message.includes(ENV_OVERRIDE),
  );
});

test("unsupported platform: error names it", () => {
  assert.throws(
    () => resolveLib(base({ platform: "win32", arch: "x64" })),
    /supports linux and darwin, not win32-x64/,
  );
});

test("compile failure is reported with the platform and the cause", () => {
  assert.throws(
    () =>
      resolveLib(
        base({
          compile: () => {
            throw new Error("boom");
          },
        }),
      ),
    (e) => /linux-x64/.test(e.message) && /boom/.test(e.message) && e.cause?.message === "boom",
  );
});

test("no writable directory anywhere: clear error", () => {
  assert.throws(() => resolveLib(base({ canWrite: () => false })), /no writable directory/);
});
