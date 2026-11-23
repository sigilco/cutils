// Loads a built shared library through koffi and exercises the shim: open an
// in-memory db, create an FTS5 table, run a query. Release CI runs it on every
// matrix runner right after build-prebuilt, so a library that links but
// misbehaves (e.g. a host-sqlite interposition zombie handle) never ships.
//
//   node scripts/check-shared-lib.mjs <path-to-library>
import { createRequire } from "node:module";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("usage: check-shared-lib.mjs <library>");
const koffi = createRequire(import.meta.url)("koffi");
const lib = koffi.load(resolve(file));
const enc = new TextEncoder();
const sp = (s) => {
  const b = enc.encode(s);
  return [b, BigInt(b.length)];
};
const open = lib.func("uint64 shim_open(const uint8_t *path, uint64 plen, int32 flags)");
const exec = lib.func("int32 shim_exec(uint64 db, const uint8_t *sql, uint64 slen)");
const prepare = lib.func("uint64 shim_prepare(uint64 db, const uint8_t *sql, uint64 slen)");
const step = lib.func("int32 shim_step(uint64 stmt)");
const finalize = lib.func("int32 shim_finalize(uint64 stmt)");
const close = lib.func("int32 shim_close(uint64 db)");

function must(cond, msg) {
  if (!cond) {
    console.error(`check-shared-lib FAIL (${process.platform}-${process.arch}): ${msg}`);
    process.exit(1);
  }
}

// flags: READWRITE | CREATE = 0x6
const db = open(...sp(":memory:"), 0x6);
must(db !== 0n, "shim_open returned a null handle");
must(exec(db, ...sp("CREATE VIRTUAL TABLE t USING fts5(body)")) === 0, "FTS5 unavailable");
must(exec(db, ...sp("INSERT INTO t(body) VALUES ('hello shared world')")) === 0, "insert failed");
const stmt = prepare(db, ...sp("SELECT count(*) FROM t WHERE t MATCH 'shared'"));
must(stmt !== 0n, "prepare failed (zombie handle?)");
must(step(stmt) === 0, "step did not return a row");
finalize(stmt);
must(close(db) === 0, "close failed");
console.log(`check-shared-lib OK: ${file}`);
