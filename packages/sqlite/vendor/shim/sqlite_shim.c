/*
 * sqlite_shim.c — FFI shim adapting the SQLite C API to scriptc's fixed-width
 * FFI ABI. One entry point per manifest function; every handle is an opaque
 * pointer, every out string/blob is written into a caller-owned buffer.
 *
 * Span ABI (scriptc ffi_format 7): `string`/`bytes` params arrive as
 * (const uint8_t *data, size_t len) pairs — length-delimited, NOT
 * NUL-terminated — and `mutable-bytes` out params as (uint8_t *buf,
 * size_t len). Callers (declares/koffi adapters) pass no separate length.
 *
 * Buffer-out convention (column name/text/blob/meta, errmsg, expanded_sql):
 *   return value >= 0  — required byte count. If it exceeds the caller's
 *                        buffer length nothing was written; grow and retry.
 *   return value  -1   — the underlying value is NULL (wrapper maps to null).
 *
 * Step convention: 0 = SQLITE_ROW, 101 = SQLITE_DONE, otherwise the raw
 * sqlite3_step() result code.
 *
 * The amalgamation is built with SQLITE_THREADSAFE=0: no locking anywhere in
 * this file. All state lives in the caller's handles.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "../sqlite-amalgamation/sqlite3.h"

/* Copy a span into a fresh NUL-terminated heap string (SQLite APIs that take
 * filenames, full SQL text, or parameter names require cstrings). Returns
 * NULL on allocation failure. */
static char *dup_cstr(const uint8_t *s, size_t n) {
  char *p = (char *)malloc(n + 1);
  if (p == NULL) return NULL;
  if (n > 0) memcpy(p, s, n);
  p[n] = '\0';
  return p;
}

/* ------------------------------------------------------------------ */
/* open / close / errors                                              */
/* ------------------------------------------------------------------ */

void *shim_open(const uint8_t *path, size_t plen, int32_t flags) {
  sqlite3 *db = NULL;
  char *zpath;
  int rc;
  zpath = dup_cstr(path, plen);
  if (zpath == NULL) return NULL;
  rc = sqlite3_open_v2(zpath, &db, (int)flags, NULL);
  free(zpath);
  if (rc != SQLITE_OK && db == NULL) {
    return NULL; /* SQLITE_NOMEM: no handle to report through */
  }
  /* On error sqlite3_open_v2 still hands back a usable handle for
   * errmsg/errcode; the wrapper checks shim_errcode next and closes. */
  return (void *)db;
}

int32_t shim_close(void *db) {
  if (db == NULL) return SQLITE_OK;
  return (int32_t)sqlite3_close((sqlite3 *)db);
}

int32_t shim_errcode(void *db) {
  /* Extended errcode so SQLITE_CONSTRAINT_* sub-codes (UNIQUE, NOTNULL,
   * FOREIGNKEY, ...) reach SqliteError.code un-mangled. */
  return (int32_t)sqlite3_extended_errcode((sqlite3 *)db);
}

/* Copy a NUL-terminated source into the caller buffer; -1 when NULL. */
static int32_t copy_cstr(const char *src, uint8_t *buf, size_t len) {
  size_t n;
  if (src == NULL) return -1;
  n = strlen(src);
  if (n > len) return (int32_t)n;
  memcpy(buf, src, n);
  return (int32_t)n;
}

/* Copy `n` raw bytes into the caller buffer; -1 when NULL. */
static int32_t copy_bytes(const void *src, int32_t n, uint8_t *buf,
                          size_t len) {
  if (src == NULL) return -1;
  if (n < 0) n = 0;
  if ((size_t)n > len) return n;
  memcpy(buf, src, (size_t)n);
  return n;
}

int32_t shim_errmsg(void *db, uint8_t *buf, size_t len) {
  return copy_cstr(sqlite3_errmsg((sqlite3 *)db), buf, len);
}

int32_t shim_in_transaction(void *db) {
  return sqlite3_get_autocommit((sqlite3 *)db) == 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* exec / transactions / savepoints                                   */
/* ------------------------------------------------------------------ */

int32_t shim_exec(void *db, const uint8_t *sql, size_t slen) {
  char *z = dup_cstr(sql, slen);
  int rc;
  if (z == NULL) return SQLITE_NOMEM;
  rc = sqlite3_exec((sqlite3 *)db, z, NULL, NULL, NULL);
  free(z);
  return (int32_t)rc;
}

int32_t shim_begin(void *db) {
  return (int32_t)sqlite3_exec((sqlite3 *)db, "BEGIN", NULL, NULL, NULL);
}

int32_t shim_commit(void *db) {
  return (int32_t)sqlite3_exec((sqlite3 *)db, "COMMIT", NULL, NULL, NULL);
}

int32_t shim_rollback(void *db) {
  return (int32_t)sqlite3_exec((sqlite3 *)db, "ROLLBACK", NULL, NULL, NULL);
}

/* op: 0 = SAVEPOINT <name>, 1 = RELEASE <name>, 2 = ROLLBACK TO + RELEASE.
 * Names are generated wrapper-side (sp_N) or user-provided; restrict to
 * identifier chars so the name can be spliced into SQL without quoting. */
static int name_ok(const uint8_t *name, size_t n) {
  size_t i;
  if (n == 0 || n > 64) return 0;
  for (i = 0; i < n; i++) {
    uint8_t c = name[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_'))
      return 0;
  }
  return 1;
}

int32_t shim_savepoint(void *db, const uint8_t *name, size_t nlen, int32_t op) {
  char sql[96];
  char zname[65];
  int rc;
  if (!name_ok(name, nlen)) return SQLITE_MISUSE;
  memcpy(zname, name, nlen);
  zname[nlen] = '\0';
  if (op == 0) {
    snprintf(sql, sizeof(sql), "SAVEPOINT %s", zname);
    return (int32_t)sqlite3_exec((sqlite3 *)db, sql, NULL, NULL, NULL);
  }
  if (op == 1) {
    snprintf(sql, sizeof(sql), "RELEASE %s", zname);
    return (int32_t)sqlite3_exec((sqlite3 *)db, sql, NULL, NULL, NULL);
  }
  if (op == 2) {
    snprintf(sql, sizeof(sql), "ROLLBACK TO %s", zname);
    rc = sqlite3_exec((sqlite3 *)db, sql, NULL, NULL, NULL);
    if (rc != SQLITE_OK) return (int32_t)rc;
    snprintf(sql, sizeof(sql), "RELEASE %s", zname);
    return (int32_t)sqlite3_exec((sqlite3 *)db, sql, NULL, NULL, NULL);
  }
  return SQLITE_MISUSE;
}

/* ------------------------------------------------------------------ */
/* statements                                                         */
/* ------------------------------------------------------------------ */

void *shim_prepare(void *db, const uint8_t *sql, size_t slen) {
  sqlite3_stmt *stmt = NULL;
  int rc = sqlite3_prepare_v2((sqlite3 *)db, (const char *)sql, (int)slen,
                              &stmt, NULL);
  if (rc != SQLITE_OK) {
    if (stmt != NULL) sqlite3_finalize(stmt);
    return NULL;
  }
  return (void *)stmt;
}

int32_t shim_step(void *stmt) {
  int rc = sqlite3_step((sqlite3_stmt *)stmt);
  if (rc == SQLITE_ROW) return 0;
  return (int32_t)rc;
}

int32_t shim_reset(void *stmt) {
  return (int32_t)sqlite3_reset((sqlite3_stmt *)stmt);
}

int32_t shim_finalize(void *stmt) {
  if (stmt == NULL) return SQLITE_OK;
  return (int32_t)sqlite3_finalize((sqlite3_stmt *)stmt);
}

int32_t shim_clear_bindings(void *stmt) {
  return (int32_t)sqlite3_clear_bindings((sqlite3_stmt *)stmt);
}

int32_t shim_stmt_readonly(void *stmt) {
  return sqlite3_stmt_readonly((sqlite3_stmt *)stmt) ? 1 : 0;
}

int32_t shim_expanded_sql(void *stmt, uint8_t *buf, size_t len) {
  char *sql = sqlite3_expanded_sql((sqlite3_stmt *)stmt);
  int32_t n;
  if (sql == NULL) return -1;
  n = copy_cstr(sql, buf, len);
  sqlite3_free(sql);
  return n;
}

/* ------------------------------------------------------------------ */
/* binding                                                            */
/* ------------------------------------------------------------------ */

int32_t shim_bind_count(void *stmt) {
  return (int32_t)sqlite3_bind_parameter_count((sqlite3_stmt *)stmt);
}

int32_t shim_bind_index(void *stmt, const uint8_t *name, size_t nlen) {
  char *z = dup_cstr(name, nlen);
  int idx;
  if (z == NULL) return 0;
  idx = sqlite3_bind_parameter_index((sqlite3_stmt *)stmt, z);
  free(z);
  return (int32_t)idx;
}

int32_t shim_bind_int(void *stmt, int32_t idx, int64_t val) {
  return (int32_t)sqlite3_bind_int64((sqlite3_stmt *)stmt, (int)idx,
                                     (sqlite3_int64)val);
}

int32_t shim_bind_dbl(void *stmt, int32_t idx, double val) {
  return (int32_t)sqlite3_bind_double((sqlite3_stmt *)stmt, (int)idx, val);
}

/* The text span is length-delimited; SQLITE_TRANSIENT copies the bytes
 * inside the call — required because the borrow is call-scoped.
 * An EMPTY span may arrive as a NULL pointer (koffi marshals an empty
 * Uint8Array as NULL; the ELF span for "" can also carry address 0) and
 * sqlite3_bind_text(NULL, n) binds SQL NULL — substitute a non-NULL
 * literal so '' stays ''. */
int32_t shim_bind_text(void *stmt, int32_t idx, const uint8_t *val,
                       size_t vlen) {
  if (val == NULL) val = (const uint8_t *)"";
  return (int32_t)sqlite3_bind_text((sqlite3_stmt *)stmt, (int)idx,
                                    (const char *)val, (int)vlen,
                                    SQLITE_TRANSIENT);
}

int32_t shim_bind_blob(void *stmt, int32_t idx, const uint8_t *val,
                       size_t vlen) {
  /* Same empty-span NULL trap as shim_bind_text. */
  if (val == NULL) val = (const uint8_t *)"";
  return (int32_t)sqlite3_bind_blob((sqlite3_stmt *)stmt, (int)idx, val,
                                    (int)vlen, SQLITE_TRANSIENT);
}

int32_t shim_bind_null(void *stmt, int32_t idx) {
  return (int32_t)sqlite3_bind_null((sqlite3_stmt *)stmt, (int)idx);
}

/* ------------------------------------------------------------------ */
/* result set access                                                  */
/* ------------------------------------------------------------------ */

int32_t shim_column_count(void *stmt) {
  return (int32_t)sqlite3_column_count((sqlite3_stmt *)stmt);
}

int32_t shim_column_name(void *stmt, int32_t idx, uint8_t *buf, size_t len) {
  const char *name = sqlite3_column_name((sqlite3_stmt *)stmt, (int)idx);
  return copy_cstr(name, buf, len);
}

/* which: 0 = origin column, 1 = table, 2 = database, 3 = declared type.
 * Needs SQLITE_ENABLE_COLUMN_METADATA for 0-2; decltype works always. */
int32_t shim_column_meta(void *stmt, int32_t idx, int32_t which, uint8_t *buf,
                         size_t len) {
  sqlite3_stmt *s = (sqlite3_stmt *)stmt;
  const char *v = NULL;
  switch (which) {
    case 0: v = sqlite3_column_origin_name(s, (int)idx); break;
    case 1: v = sqlite3_column_table_name(s, (int)idx); break;
    case 2: v = sqlite3_column_database_name(s, (int)idx); break;
    case 3: v = sqlite3_column_decltype(s, (int)idx); break;
    default: return -2;
  }
  return copy_cstr(v, buf, len);
}

int32_t shim_column_type(void *stmt, int32_t idx) {
  return (int32_t)sqlite3_column_type((sqlite3_stmt *)stmt, (int)idx);
}

int64_t shim_column_int64(void *stmt, int32_t idx) {
  return (int64_t)sqlite3_column_int64((sqlite3_stmt *)stmt, (int)idx);
}

double shim_column_dbl(void *stmt, int32_t idx) {
  return sqlite3_column_double((sqlite3_stmt *)stmt, (int)idx);
}

int32_t shim_column_text(void *stmt, int32_t idx, uint8_t *buf, size_t len) {
  sqlite3_stmt *s = (sqlite3_stmt *)stmt;
  const void *v = sqlite3_column_text(s, (int)idx);
  int32_t n = (int32_t)sqlite3_column_bytes(s, (int)idx);
  return copy_bytes(v, n, buf, len);
}

int32_t shim_column_blob(void *stmt, int32_t idx, uint8_t *buf, size_t len) {
  sqlite3_stmt *s = (sqlite3_stmt *)stmt;
  const void *v = sqlite3_column_blob(s, (int)idx);
  int32_t n = (int32_t)sqlite3_column_bytes(s, (int)idx);
  return copy_bytes(v, n, buf, len);
}

/* ------------------------------------------------------------------ */
/* write bookkeeping                                                  */
/* ------------------------------------------------------------------ */

int64_t shim_last_insert_rowid(void *db) {
  return (int64_t)sqlite3_last_insert_rowid((sqlite3 *)db);
}

int32_t shim_changes(void *db) {
  return (int32_t)sqlite3_changes((sqlite3 *)db);
}
