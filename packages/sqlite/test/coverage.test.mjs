// coverage.test.mjs — the scriptc coverage gate as a node:test case:
// gate.ts (the whole public surface) must report 100% static under
// `scriptc coverage --ffi gate.ffi.json`.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scriptc coverage gate.ts is 100% static", () => {
  const out = execFileSync(
    "pnpm",
    ["exec", "scriptc", "coverage", "gate.ts", "--ffi", "gate.ffi.json"],
    { cwd: pkg, encoding: "utf8" },
  );
  assert.match(out, /compile statically\s+\d+\s+\(100%\)/, out);
});
