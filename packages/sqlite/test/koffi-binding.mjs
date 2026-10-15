// Installs the `shim_*` globals the emitted dist/esm/internal/ffi.js calls,
// backed by the shared build (build/libcutils_sqlite.so) through koffi.
// The scriptc span ABI means string/bytes params cross as (ptr,len) pairs —
// koffi can't produce that layout from a JS string, so each binding is
// wrapped in a JS adapter that encodes the span explicitly. Handles cross
// as uint64 bigints (pointer-sized on x86_64/aarch64).

import koffi from "koffi";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const lib = koffi.load(path.join(dir, "..", "build", "libcutils_sqlite.so"));

const g = globalThis;
const enc = new TextEncoder();

const f = {
  open: lib.func("uint64 shim_open(const uint8_t *path, uint64 plen, int32 flags)"),
  close: lib.func("int32 shim_close(uint64 db)"),
  errcode: lib.func("int32 shim_errcode(uint64 db)"),
  errmsg: lib.func("int32 shim_errmsg(uint64 db, uint8_t *buf, uint64 len)"),
  inTransaction: lib.func("int32 shim_in_transaction(uint64 db)"),
  exec: lib.func("int32 shim_exec(uint64 db, const uint8_t *sql, uint64 slen)"),
  begin: lib.func("int32 shim_begin(uint64 db)"),
  commit: lib.func("int32 shim_commit(uint64 db)"),
  rollback: lib.func("int32 shim_rollback(uint64 db)"),
  savepoint: lib.func(
    "int32 shim_savepoint(uint64 db, const uint8_t *name, uint64 nlen, int32 op)",
  ),
  prepare: lib.func("uint64 shim_prepare(uint64 db, const uint8_t *sql, uint64 slen)"),
  step: lib.func("int32 shim_step(uint64 stmt)"),
  reset: lib.func("int32 shim_reset(uint64 stmt)"),
  finalize: lib.func("int32 shim_finalize(uint64 stmt)"),
  clearBindings: lib.func("int32 shim_clear_bindings(uint64 stmt)"),
  stmtReadonly: lib.func("int32 shim_stmt_readonly(uint64 stmt)"),
  expandedSql: lib.func("int32 shim_expanded_sql(uint64 stmt, uint8_t *buf, uint64 len)"),
  bindCount: lib.func("int32 shim_bind_count(uint64 stmt)"),
  bindIndex: lib.func("int32 shim_bind_index(uint64 stmt, const uint8_t *name, uint64 nlen)"),
  bindInt: lib.func("int32 shim_bind_int(uint64 stmt, int32 idx, int64 val)"),
  bindDbl: lib.func("int32 shim_bind_dbl(uint64 stmt, int32 idx, double val)"),
  bindText: lib.func(
    "int32 shim_bind_text(uint64 stmt, int32 idx, const uint8_t *val, uint64 vlen)",
  ),
  bindBlob: lib.func(
    "int32 shim_bind_blob(uint64 stmt, int32 idx, const uint8_t *val, uint64 vlen)",
  ),
  bindNull: lib.func("int32 shim_bind_null(uint64 stmt, int32 idx)"),
  columnCount: lib.func("int32 shim_column_count(uint64 stmt)"),
  columnName: lib.func("int32 shim_column_name(uint64 stmt, int32 idx, uint8_t *buf, uint64 len)"),
  columnMeta: lib.func(
    "int32 shim_column_meta(uint64 stmt, int32 idx, int32 which, uint8_t *buf, uint64 len)",
  ),
  columnType: lib.func("int32 shim_column_type(uint64 stmt, int32 idx)"),
  columnInt64: lib.func("int64 shim_column_int64(uint64 stmt, int32 idx)"),
  columnDbl: lib.func("double shim_column_dbl(uint64 stmt, int32 idx)"),
  columnText: lib.func("int32 shim_column_text(uint64 stmt, int32 idx, uint8_t *buf, uint64 len)"),
  columnBlob: lib.func("int32 shim_column_blob(uint64 stmt, int32 idx, uint8_t *buf, uint64 len)"),
  lastInsertRowid: lib.func("int64 shim_last_insert_rowid(uint64 db)"),
  changes: lib.func("int32 shim_changes(uint64 db)"),
};

function span(s) {
  const b = enc.encode(s);
  return [b, BigInt(b.length)];
}

g.shim_open = (path, flags) => {
  const [b, n] = span(path);
  return f.open(b, n, flags);
};
g.shim_close = (db) => f.close(db);
g.shim_errcode = (db) => f.errcode(db);
g.shim_errmsg = (db, buf) => f.errmsg(db, buf, BigInt(buf.length));
g.shim_in_transaction = (db) => f.inTransaction(db);
g.shim_exec = (db, sql) => {
  const [b, n] = span(sql);
  return f.exec(db, b, n);
};
g.shim_begin = (db) => f.begin(db);
g.shim_commit = (db) => f.commit(db);
g.shim_rollback = (db) => f.rollback(db);
g.shim_savepoint = (db, name, op) => {
  const [b, n] = span(name);
  return f.savepoint(db, b, n, op);
};
g.shim_prepare = (db, sql) => {
  const [b, n] = span(sql);
  return f.prepare(db, b, n);
};
g.shim_step = (stmt) => f.step(stmt);
g.shim_reset = (stmt) => f.reset(stmt);
g.shim_finalize = (stmt) => f.finalize(stmt);
g.shim_clear_bindings = (stmt) => f.clearBindings(stmt);
g.shim_stmt_readonly = (stmt) => f.stmtReadonly(stmt);
g.shim_expanded_sql = (stmt, buf) => f.expandedSql(stmt, buf, BigInt(buf.length));
g.shim_bind_count = (stmt) => f.bindCount(stmt);
g.shim_bind_index = (stmt, name) => {
  const [b, n] = span(name);
  return f.bindIndex(stmt, b, n);
};
g.shim_bind_int = (stmt, idx, val) => f.bindInt(stmt, idx, val);
g.shim_bind_dbl = (stmt, idx, val) => f.bindDbl(stmt, idx, val);
g.shim_bind_text = (stmt, idx, val) => {
  const [b, n] = span(val);
  return f.bindText(stmt, idx, b, n);
};
g.shim_bind_blob = (stmt, idx, val) => f.bindBlob(stmt, idx, val, BigInt(val.length));
g.shim_bind_null = (stmt, idx) => f.bindNull(stmt, idx);
g.shim_column_count = (stmt) => f.columnCount(stmt);
g.shim_column_name = (stmt, idx, buf) => f.columnName(stmt, idx, buf, BigInt(buf.length));
g.shim_column_meta = (stmt, idx, which, buf) =>
  f.columnMeta(stmt, idx, which, buf, BigInt(buf.length));
g.shim_column_type = (stmt, idx) => f.columnType(stmt, idx);
g.shim_column_int64 = (stmt, idx) => f.columnInt64(stmt, idx);
g.shim_column_dbl = (stmt, idx) => f.columnDbl(stmt, idx);
g.shim_column_text = (stmt, idx, buf) => f.columnText(stmt, idx, buf, BigInt(buf.length));
g.shim_column_blob = (stmt, idx, buf) => f.columnBlob(stmt, idx, buf, BigInt(buf.length));
g.shim_last_insert_rowid = (db) => f.lastInsertRowid(db);
g.shim_changes = (db) => f.changes(db);
