// declare-function bindings for vendor/shim/sqlite_shim.c.
// These must match vendor/manifest.json exactly (names, arity, types).
// Span ABI: `string` params marshal as (ptr,len) — the declares pass only
// the JS string; `mutable-bytes` out params marshal as (buf,len) — the
// declares pass only the Uint8Array. Thin exported wrappers re-expose the
// bindings: ambient declarations cannot be exported. Under plain Node the
// emitted calls resolve on globalThis — test/koffi-binding.mjs installs
// matching globals loaded through koffi.

declare function shim_open(path: string, flags: number): bigint;
declare function shim_close(db: bigint): number;
declare function shim_errcode(db: bigint): number;
declare function shim_errmsg(db: bigint, buf: Uint8Array): number;
declare function shim_in_transaction(db: bigint): number;
declare function shim_exec(db: bigint, sql: string): number;
declare function shim_begin(db: bigint): number;
declare function shim_commit(db: bigint): number;
declare function shim_rollback(db: bigint): number;
declare function shim_savepoint(db: bigint, name: string, op: number): number;
declare function shim_prepare(db: bigint, sql: string): bigint;
declare function shim_step(stmt: bigint): number;
declare function shim_reset(stmt: bigint): number;
declare function shim_finalize(stmt: bigint): number;
declare function shim_clear_bindings(stmt: bigint): number;
declare function shim_stmt_readonly(stmt: bigint): number;
declare function shim_expanded_sql(stmt: bigint, buf: Uint8Array): number;
declare function shim_bind_count(stmt: bigint): number;
declare function shim_bind_index(stmt: bigint, name: string): number;
declare function shim_bind_int(stmt: bigint, idx: number, val: bigint): number;
declare function shim_bind_dbl(stmt: bigint, idx: number, val: number): number;
declare function shim_bind_text(stmt: bigint, idx: number, val: string): number;
declare function shim_bind_blob(stmt: bigint, idx: number, val: Uint8Array): number;
declare function shim_bind_null(stmt: bigint, idx: number): number;
declare function shim_column_count(stmt: bigint): number;
declare function shim_column_name(stmt: bigint, idx: number, buf: Uint8Array): number;
declare function shim_column_meta(
  stmt: bigint,
  idx: number,
  which: number,
  buf: Uint8Array,
): number;
declare function shim_column_type(stmt: bigint, idx: number): number;
declare function shim_column_int64(stmt: bigint, idx: number): bigint;
declare function shim_column_dbl(stmt: bigint, idx: number): number;
declare function shim_column_text(stmt: bigint, idx: number, buf: Uint8Array): number;
declare function shim_column_blob(stmt: bigint, idx: number, buf: Uint8Array): number;
declare function shim_last_insert_rowid(db: bigint): bigint;
declare function shim_changes(db: bigint): number;

export function ffiOpen(path: string, flags: number): bigint {
  return shim_open(path, flags);
}
export function ffiClose(db: bigint): number {
  return shim_close(db);
}
export function ffiErrcode(db: bigint): number {
  return shim_errcode(db);
}
export function ffiErrmsg(db: bigint, buf: Uint8Array): number {
  return shim_errmsg(db, buf);
}
export function ffiInTransaction(db: bigint): number {
  return shim_in_transaction(db);
}
export function ffiExec(db: bigint, sql: string): number {
  return shim_exec(db, sql);
}
export function ffiBegin(db: bigint): number {
  return shim_begin(db);
}
export function ffiCommit(db: bigint): number {
  return shim_commit(db);
}
export function ffiRollback(db: bigint): number {
  return shim_rollback(db);
}
export function ffiSavepoint(db: bigint, name: string, op: number): number {
  return shim_savepoint(db, name, op);
}
export function ffiPrepare(db: bigint, sql: string): bigint {
  return shim_prepare(db, sql);
}
export function ffiStep(stmt: bigint): number {
  return shim_step(stmt);
}
export function ffiReset(stmt: bigint): number {
  return shim_reset(stmt);
}
export function ffiFinalize(stmt: bigint): number {
  return shim_finalize(stmt);
}
export function ffiClearBindings(stmt: bigint): number {
  return shim_clear_bindings(stmt);
}
export function ffiStmtReadonly(stmt: bigint): number {
  return shim_stmt_readonly(stmt);
}
export function ffiExpandedSql(stmt: bigint, buf: Uint8Array): number {
  return shim_expanded_sql(stmt, buf);
}
export function ffiBindCount(stmt: bigint): number {
  return shim_bind_count(stmt);
}
export function ffiBindIndex(stmt: bigint, name: string): number {
  return shim_bind_index(stmt, name);
}
export function ffiBindInt(stmt: bigint, idx: number, val: bigint): number {
  return shim_bind_int(stmt, idx, val);
}
export function ffiBindDbl(stmt: bigint, idx: number, val: number): number {
  return shim_bind_dbl(stmt, idx, val);
}
export function ffiBindText(stmt: bigint, idx: number, val: string): number {
  return shim_bind_text(stmt, idx, val);
}
export function ffiBindBlob(stmt: bigint, idx: number, val: Uint8Array): number {
  return shim_bind_blob(stmt, idx, val);
}
export function ffiBindNull(stmt: bigint, idx: number): number {
  return shim_bind_null(stmt, idx);
}
export function ffiColumnCount(stmt: bigint): number {
  return shim_column_count(stmt);
}
export function ffiColumnName(stmt: bigint, idx: number, buf: Uint8Array): number {
  return shim_column_name(stmt, idx, buf);
}
export function ffiColumnMeta(stmt: bigint, idx: number, which: number, buf: Uint8Array): number {
  return shim_column_meta(stmt, idx, which, buf);
}
export function ffiColumnType(stmt: bigint, idx: number): number {
  return shim_column_type(stmt, idx);
}
export function ffiColumnInt64(stmt: bigint, idx: number): bigint {
  return shim_column_int64(stmt, idx);
}
export function ffiColumnDbl(stmt: bigint, idx: number): number {
  return shim_column_dbl(stmt, idx);
}
export function ffiColumnText(stmt: bigint, idx: number, buf: Uint8Array): number {
  return shim_column_text(stmt, idx, buf);
}
export function ffiColumnBlob(stmt: bigint, idx: number, buf: Uint8Array): number {
  return shim_column_blob(stmt, idx, buf);
}
export function ffiLastInsertRowid(db: bigint): bigint {
  return shim_last_insert_rowid(db);
}
export function ffiChanges(db: bigint): number {
  return shim_changes(db);
}
