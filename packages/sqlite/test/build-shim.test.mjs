// scripts/build-shim.mjs builds a host-target archive with FTS5 + a manifest
// whose `libraries` points at it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("build-shim.mjs emits an archive and a matching ffi manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "cutils-shim-"));
  const r = spawnSync("node", [new URL("../scripts/build-shim.mjs", import.meta.url).pathname, "--out", out], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, "libsqlite3-shim.a")));
  const m = JSON.parse(readFileSync(join(out, "ffi.json"), "utf8"));
  assert.equal(m.ffi_format, 7);
  assert.deepEqual(m.libraries, [join(out, "libsqlite3-shim.a")]);
  assert.ok(m.functions.some((f) => f.name === "shim_open"));
});
