// Builds the vendored sqlite shim archive for ONE target and writes a matching
// scriptc ffi manifest next to it. The archive shipped in the tarball
// (build/libsqlite3-shim.a) is built on Linux in CI, so macOS and Windows
// consumers (and cross-compiles) need an archive for their own target:
//
//   node node_modules/@cutils/sqlite/scripts/build-shim.mjs --out ./shim
//   scriptc build app.ts --npm-static @cutils/sqlite --ffi ./shim/ffi.json
//
// Cross-compile with zig as the C toolchain:
//
//   CC="zig cc" AR="zig ar" node .../build-shim.mjs --out ./shim-win \
//     --target x86_64-windows-gnu
//
// Flags: --out <dir> (default ./build), --target <clang triple>, --cc, --ar
// (default $CC / $AR, else cc / ar). SQLite is built with FTS5, the same
// flags as `pnpm build`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const SQLITE_FLAGS = [
  "-O2",
  "-DSQLITE_THREADSAFE=0",
  "-DSQLITE_OMIT_LOAD_EXTENSION",
  "-DSQLITE_ENABLE_COLUMN_METADATA",
  "-DSQLITE_ENABLE_FTS5",
];

function parseArgs(argv) {
  const opts = { out: "build", target: "", cc: process.env.CC || "cc", ar: process.env.AR || "ar" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!["--out", "--target", "--cc", "--ar"].includes(k) || v === undefined) {
      throw new Error(`usage: build-shim.mjs [--out dir] [--target triple] [--cc cmd] [--ar cmd] (bad arg: ${k})`);
    }
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

function run(cmd, args) {
  const [bin, ...pre] = cmd.split(/\s+/);
  const r = spawnSync(bin, [...pre, ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status ?? r.signal})`);
}

const pkg = resolve(new URL("..", import.meta.url).pathname);
const opts = parseArgs(process.argv.slice(2));
const out = resolve(opts.out);
const flags = opts.target ? [...SQLITE_FLAGS, "-target", opts.target] : SQLITE_FLAGS;
mkdirSync(out, { recursive: true });
run(opts.cc, [...flags, "-c", `${pkg}/vendor/shim/sqlite_shim.c`, "-o", `${out}/sqlite_shim.o`]);
run(opts.cc, [...flags, "-c", `${pkg}/vendor/sqlite-amalgamation/sqlite3.c`, "-o", `${out}/sqlite3.o`]);
rmSync(`${out}/libsqlite3-shim.a`, { force: true });
run(opts.ar, ["rcs", `${out}/libsqlite3-shim.a`, `${out}/sqlite_shim.o`, `${out}/sqlite3.o`]);
const manifest = JSON.parse(readFileSync(`${pkg}/ffi.json`, "utf8"));
manifest.libraries = [`${out}/libsqlite3-shim.a`];
writeFileSync(`${out}/ffi.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${out}/libsqlite3-shim.a and ${out}/ffi.json`);
