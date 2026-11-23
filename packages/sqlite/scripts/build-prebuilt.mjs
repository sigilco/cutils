// Builds the shared library for ONE target into prebuilt/<platform>-<arch>/,
// the layout node/resolve-lib.mjs looks up. Release CI runs this per matrix
// runner and assembles the folders into the tarball; `pnpm smoke:pack` runs it
// for the host so the pack smoke exercises the prebuilt path.
//
//   node scripts/build-prebuilt.mjs                       # host target
//   CC="cc -arch x86_64" node scripts/build-prebuilt.mjs --id darwin-x64
//
// --id must name a target the host toolchain can actually produce (the script
// cannot cross-compile by itself; supply the flags through $CC).
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { libExt, PREBUILT_TARGETS, targetId } from "../node/resolve-lib.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
let id = targetId(process.platform, process.arch);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--id" && argv[i + 1]) id = argv[++i];
  else throw new Error(`usage: build-prebuilt.mjs [--id <platform>-<arch>] (bad arg: ${argv[i]})`);
}
if (!PREBUILT_TARGETS.includes(id)) {
  throw new Error(
    `build-prebuilt: unsupported target ${id} (supported: ${PREBUILT_TARGETS.join(", ")})`,
  );
}
const ext = libExt(id.split("-")[0]);
const out = join(pkg, "prebuilt", id, `libcutils_sqlite.${ext}`);
mkdirSync(dirname(out), { recursive: true });
const r = spawnSync("sh", [join(pkg, "scripts", "build-shared.sh"), out], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`prebuilt ${id}: ${out} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
