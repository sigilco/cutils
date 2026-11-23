// Release guard: fails unless every PREBUILT_TARGETS library is present in
// prebuilt/ (and non-trivially sized), so a publish can never ship a tarball
// that lacks a platform's shared library.
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREBUILT_TARGETS, prebuiltPath } from "../node/resolve-lib.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
for (const id of PREBUILT_TARGETS) {
  const [platform, arch] = id.split("-");
  const file = prebuiltPath(pkg, platform, arch);
  if (!existsSync(file) || statSync(file).size < 500_000) {
    console.error(`assert-prebuilt FAIL: missing or truncated ${file}`);
    bad = 1;
  } else {
    console.log(`assert-prebuilt: ${id} ${(statSync(file).size / 1048576).toFixed(2)} MB`);
  }
}
process.exit(bad);
