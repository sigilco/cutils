// Locates the shared library the koffi binding loads. Free of koffi so it is
// unit-testable (test/resolve-lib.test.mjs); every side effect is injectable.
//
// Order:
//   1. $CUTILS_SQLITE_LIB            explicit override, must exist
//   2. prebuilt/<platform>-<arch>/   shipped in the npm tarball (release CI)
//   3. build/libcutils_sqlite.so     `pnpm build:shared` / a consumer build
//   4. compile from vendor/          needs a C compiler; cached for next time
// Anything else throws an error naming the platform, arch and what was tried.
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_OVERRIDE = "CUTILS_SQLITE_LIB";

/** Targets the release workflow builds a prebuilt library for. */
export const PREBUILT_TARGETS = [
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "win32-arm64",
];

/** Library file extension for a Node `process.platform`, or null if unsupported. */
export function libExt(platform) {
  if (platform === "linux") return "so";
  if (platform === "darwin") return "dylib";
  if (platform === "win32") return "dll";
  return null;
}

export function targetId(platform, arch) {
  return `${platform}-${arch}`;
}

/** Path of the prebuilt inside the package root, or null on unsupported platforms. */
export function prebuiltPath(pkgRoot, platform, arch) {
  const ext = libExt(platform);
  if (ext === null) return null;
  return join(pkgRoot, "prebuilt", targetId(platform, arch), `libcutils_sqlite.${ext}`);
}

/** The in-package dev/consumer build output (what `build:shared` writes). */
export function localBuildPath(pkgRoot, platform = process.platform) {
  return join(pkgRoot, "build", `libcutils_sqlite.${libExt(platform) ?? "so"}`);
}

function defaultCanWrite(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultHasCompiler(cc) {
  const [bin, ...pre] = cc.split(/\s+/);
  return spawnSync(bin, [...pre, "--version"], { stdio: "ignore" }).status === 0;
}

function defaultCompile(pkgRoot, cc, out) {
  // win32 has no `sh`; Git Bash's bash.exe is on PATH on dev machines and CI.
  const shell = process.platform === "win32" ? "bash" : "sh";
  // Forward slashes survive sh argv on win32 (C:/... is valid for git-bash).
  const posix = (p) => p.replace(/\\/g, "/");
  const tmp = `${out}.${process.pid}.tmp`;
  const r = spawnSync(shell, [posix(join(pkgRoot, "scripts", "build-shared.sh")), posix(tmp)], {
    env: { ...process.env, CC: cc },
    encoding: "utf8",
  });
  if (r.error || r.status !== 0) {
    rmSync(tmp, { force: true });
    const why = r.error ? r.error.message : `exited ${r.status ?? r.signal}`;
    const tail = (r.stderr || "").trim().split("\n").slice(-5).join("\n");
    throw new Error(`build-shared.sh ${why}: ${tail}`);
  }
  renameSync(tmp, out); // atomic: concurrent first imports never see a half file
}

/**
 * Resolve the library. Returns `{ path, source }` where source is one of
 * "env" | "prebuilt" | "local-build" | "compiled". `pkgRoot` is required;
 * every other option defaults to the real process/fs and exists for tests.
 */
export function resolveLib(opts) {
  const o = {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    exists: existsSync,
    canWrite: defaultCanWrite,
    hasCompiler: defaultHasCompiler,
    compile: defaultCompile,
    tmp: tmpdir(),
    version: "unknown",
    ...opts,
  };
  const id = targetId(o.platform, o.arch);
  const tried = [];

  const override = o.env[ENV_OVERRIDE];
  if (override) {
    if (o.exists(override)) return { path: override, source: "env" };
    throw new Error(`@cutils/sqlite: ${ENV_OVERRIDE}=${override} does not exist`);
  }

  if (libExt(o.platform) === null) {
    throw new Error(
      `@cutils/sqlite: the Node binding supports linux, darwin and windows, not ${id}. ` +
        `Use the scriptc static build there, or set ${ENV_OVERRIDE} to a shared library built for ${id}.`,
    );
  }

  const prebuilt = prebuiltPath(o.pkgRoot, o.platform, o.arch);
  tried.push(prebuilt);
  if (o.exists(prebuilt)) return { path: prebuilt, source: "prebuilt" };

  const local = localBuildPath(o.pkgRoot, o.platform);
  tried.push(local);
  if (o.exists(local)) return { path: local, source: "local-build" };

  const cc = o.env.CC || "cc";
  if (!o.hasCompiler(cc)) {
    throw new Error(
      `@cutils/sqlite: no prebuilt library for ${id} and no C compiler (${cc}) to build one. ` +
        `Tried: ${tried.join(", ")}. Install a C compiler (Xcode command line tools on macOS, ` +
        `build-essential on Debian/Ubuntu), or set ${ENV_OVERRIDE} to a shared library built for ${id}.`,
    );
  }
  // Prefer the package dir; fall back to a per-version tmp cache when
  // node_modules is read-only.
  const dirs = [join(o.pkgRoot, "build"), join(o.tmp, `cutils-sqlite-${o.version}-${id}`)];
  for (const dir of dirs) {
    if (!o.canWrite(dir)) continue;
    const out = join(dir, `libcutils_sqlite.${libExt(o.platform)}`);
    if (o.exists(out)) return { path: out, source: "compiled" };
    try {
      o.compile(o.pkgRoot, cc, out);
    } catch (e) {
      throw new Error(
        `@cutils/sqlite: no prebuilt library for ${id} and compiling from vendor/ failed: ${e.message}`,
        { cause: e },
      );
    }
    return { path: out, source: "compiled" };
  }
  throw new Error(
    `@cutils/sqlite: no prebuilt library for ${id} and no writable directory to compile into ` +
      `(tried ${dirs.join(", ")}). Set ${ENV_OVERRIDE} to a prebuilt shared library.`,
  );
}

/** Package root for the shipped layout (node/ sits directly under it). */
export function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function packageVersion(pkgRoot) {
  try {
    return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}
