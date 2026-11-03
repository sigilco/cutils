// Copies cargo's cdylib out of the target dir under the platform's shared
// library name (.so on Linux, .dylib on macOS). Cargo's output name is not
// platform-stable, so the copy cannot be a plain `cp` in package.json.
//
// Usage: copy-shared.mjs <cargo-release-dir> <cargo-lib-name>
// e.g.   copy-shared.mjs build/cargo/release cutils_ffi_echo
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const [fromDir, name] = process.argv.slice(2);
if (!fromDir || !name) {
  throw new Error("usage: copy-shared.mjs <cargo-release-dir> <cargo-lib-name>");
}

const suffix = process.platform === "darwin" ? "dylib" : "so";
const source = path.join(fromDir, `lib${name}.${suffix}`);
if (!existsSync(source)) {
  throw new Error(`cargo produced no ${source}`);
}
const target = path.join("build", `lib${name}.${suffix}`);
copyFileSync(source, target);
console.log(`copied ${source} -> ${target}`);
