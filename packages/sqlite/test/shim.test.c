/* shim.test.c — C-level assertions over build/libsqlite3-shim.a.
 * Exercises the span ABI signatures directly: every string/bytes arg is a
 * (ptr, len) pair, every out param a caller-owned buffer. */

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

extern void *shim_open(const uint8_t *path, size_t plen, int32_t flags);
extern int32_t shim_close(void *db);
extern int32_t shim_errcode(void *db);
extern int32_t shim_errmsg(void *db, uint8_t *buf, size_t len);
extern int32_t shim_in_transaction(void *db);
extern int32_t shim_exec(void *db, const uint8_t *sql, size_t slen);
extern int32_t shim_begin(void *db);
extern int32_t shim_commit(void *db);
extern int32_t shim_rollback(void *db);
extern int32_t shim_savepoint(void *db, const uint8_t *name, size_t nlen,
                              int32_t op);
extern void *shim_prepare(void *db, const uint8_t *sql, size_t slen);
extern int32_t shim_step(void *stmt);
extern int32_t shim_reset(void *stmt);
extern int32_t shim_finalize(void *stmt);
extern int32_t shim_clear_bindings(void *stmt);
extern int32_t shim_stmt_readonly(void *stmt);
extern int32_t shim_expanded_sql(void *stmt, uint8_t *buf, size_t len);
extern int32_t shim_bind_count(void *stmt);
extern int32_t shim_bind_index(void *stmt, const uint8_t *name, size_t nlen);
extern int32_t shim_bind_int(void *stmt, int32_t idx, int64_t val);
extern int32_t shim_bind_dbl(void *stmt, int32_t idx, double val);
extern int32_t shim_bind_text(void *stmt, int32_t idx, const uint8_t *val,
                              size_t vlen);
extern int32_t shim_bind_blob(void *stmt, int32_t idx, const uint8_t *val,
                              size_t vlen);
extern int32_t shim_bind_null(void *stmt, int32_t idx);
extern int32_t shim_column_count(void *stmt);
extern int32_t shim_column_name(void *stmt, int32_t idx, uint8_t *buf,
                                size_t len);
extern int32_t shim_column_meta(void *stmt, int32_t idx, int32_t which,
                                uint8_t *buf, size_t len);
extern int32_t shim_column_type(void *stmt, int32_t idx);
extern int64_t shim_column_int64(void *stmt, int32_t idx);
extern double shim_column_dbl(void *stmt, int32_t idx);
extern int32_t shim_column_text(void *stmt, int32_t idx, uint8_t *buf,
                                size_t len);
extern int32_t shim_column_blob(void *stmt, int32_t idx, uint8_t *buf,
                                size_t len);
extern int64_t shim_last_insert_rowid(void *db);
extern int32_t shim_changes(void *db);

static const uint8_t *S(const char *s) { return (const uint8_t *)s; }
/* String-literal span: (ptr, exact len). */
#define SL(x) S(x), strlen(x)

int main(void) {
  uint8_t buf[512];
  void *db, *st;
  int32_t n, rc;

  /* open :memory: (read-write + create = 6) */
  db = shim_open(SL(":memory:"), 6);
  assert(db != NULL);
  assert(shim_errcode(db) == 0);
  assert(shim_in_transaction(db) == 0);

  /* exec DDL */
  rc = shim_exec(db, SL("CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT NOT NULL, f REAL, b BLOB, i INTEGER)"));
  assert(rc == 0);

  /* prepare + bind + step + columns */
  st = shim_prepare(db, SL("INSERT INTO t (s, f, b, i) VALUES (?, ?, ?, ?)"));
  assert(st != NULL);
  assert(shim_bind_count(st) == 4);
  assert(shim_stmt_readonly(st) == 0);
  assert(shim_bind_text(st, 1, SL("hello")) == 0);
  assert(shim_bind_dbl(st, 2, 2.5) == 0);
  {
    uint8_t blob[3] = {9, 8, 7};
    assert(shim_bind_blob(st, 3, blob, 3) == 0);
  }
  assert(shim_bind_int(st, 4, 9007199254740993LL) == 0);
  assert(shim_step(st) == 101); /* DONE */
  assert(shim_finalize(st) == 0);
  assert(shim_last_insert_rowid(db) == 1);
  assert(shim_changes(db) == 1);

  /* named bind index */
  st = shim_prepare(db, SL("INSERT INTO t (s) VALUES (:s)"));
  assert(st != NULL);
  assert(shim_bind_index(st, SL(":s")) == 1);
  assert(shim_bind_index(st, SL(":nope")) == 0);
  assert(shim_bind_text(st, 1, SL("named")) == 0);
  assert(shim_step(st) == 101);
  assert(shim_finalize(st) == 0);

  /* select: column name/type/int64/dbl/text/blob + expanded sql */
  st = shim_prepare(db, SL("SELECT id, s, f, b, i FROM t ORDER BY id"));
  assert(st != NULL);
  assert(shim_stmt_readonly(st) == 1);
  assert(shim_column_count(st) == 5);
  memset(buf, 0, sizeof(buf));
  n = shim_column_name(st, 1, buf, sizeof(buf));
  assert(n == 1 && memcmp(buf, "s", 1) == 0);
  n = shim_column_meta(st, 1, 1, buf, sizeof(buf));
  assert(n == 1 && memcmp(buf, "t", 1) == 0);
  n = shim_expanded_sql(st, buf, sizeof(buf));
  assert(n > 0);

  assert(shim_step(st) == 0); /* ROW */
  assert(shim_column_type(st, 0) == 1); /* INTEGER */
  assert(shim_column_int64(st, 0) == 1);
  n = shim_column_text(st, 1, buf, sizeof(buf));
  assert(n == 5 && memcmp(buf, "hello", 5) == 0);
  assert(shim_column_dbl(st, 2) == 2.5);
  n = shim_column_blob(st, 3, buf, sizeof(buf));
  assert(n == 3 && buf[0] == 9 && buf[2] == 7);
  assert(shim_column_int64(st, 4) == 9007199254740993LL);
  assert(shim_step(st) == 0); /* second row */
  n = shim_column_text(st, 1, buf, sizeof(buf));
  assert(n == 5 && memcmp(buf, "named", 5) == 0);
  assert(shim_column_type(st, 1) == 3); /* TEXT */
  assert(shim_step(st) == 101);
  assert(shim_reset(st) == 0);
  assert(shim_clear_bindings(st) == 0);
  assert(shim_finalize(st) == 0);

  /* transactions + savepoints */
  assert(shim_begin(db) == 0);
  assert(shim_in_transaction(db) == 1);
  assert(shim_savepoint(db, SL("sp1"), 0) == 0);
  assert(shim_exec(db, SL("INSERT INTO t (s) VALUES ('x')")) == 0);
  assert(shim_savepoint(db, SL("sp1"), 2) == 0); /* rollback to + release */
  assert(shim_commit(db) == 0);
  assert(shim_in_transaction(db) == 0);
  assert(shim_begin(db) == 0);
  assert(shim_rollback(db) == 0);

  /* error path: NOT NULL violation → extended code 1299 */
  rc = shim_exec(db, SL("INSERT INTO t (s) VALUES (NULL)"));
  assert(rc == 19);
  assert(shim_errcode(db) == 1299); /* SQLITE_CONSTRAINT_NOTNULL */
  n = shim_errmsg(db, buf, sizeof(buf));
  assert(n > 0);

  /* bad prepare returns NULL; errcode reports the parse error */
  st = shim_prepare(db, SL("SELECT FROM"));
  assert(st == NULL);
  assert(shim_errcode(db) == 1); /* SQLITE_ERROR */

  assert(shim_close(db) == 0);
  printf("shim.test.c OK\n");
  return 0;
}
