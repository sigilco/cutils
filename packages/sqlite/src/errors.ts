// SqliteError + the numeric-result-code → name mapping.

export class SqliteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SqliteError";
    this.code = code;
  }
}

// Primary result codes (rc & 0xFF) plus the constraint extended codes —
// the names better-sqlite3 users will recognize from `err.code`.
export function sqliteCodeName(rc: number): string {
  switch (rc) {
    case 275:
      return "SQLITE_CONSTRAINT_CHECK";
    case 531:
      return "SQLITE_CONSTRAINT_COMMITHOOK";
    case 787:
      return "SQLITE_CONSTRAINT_FOREIGNKEY";
    case 803:
      return "SQLITE_CONSTRAINT_FUNCTION";
    case 1027:
      return "SQLITE_CONSTRAINT_TRIGGER";
    case 1043:
      return "SQLITE_CONSTRAINT_VTAB";
    case 1299:
      return "SQLITE_CONSTRAINT_NOTNULL";
    case 1555:
      return "SQLITE_CONSTRAINT_PRIMARYKEY";
    case 2067:
      return "SQLITE_CONSTRAINT_UNIQUE";
    case 2579:
      return "SQLITE_CONSTRAINT_ROWID";
    case 2835:
      return "SQLITE_CONSTRAINT_PINNED";
    case 3091:
      return "SQLITE_CONSTRAINT_DATATYPE";
    default:
      break;
  }
  const primary = rc & 255;
  switch (primary) {
    case 1:
      return "SQLITE_ERROR";
    case 2:
      return "SQLITE_INTERNAL";
    case 3:
      return "SQLITE_PERM";
    case 4:
      return "SQLITE_ABORT";
    case 5:
      return "SQLITE_BUSY";
    case 6:
      return "SQLITE_LOCKED";
    case 7:
      return "SQLITE_NOMEM";
    case 8:
      return "SQLITE_READONLY";
    case 9:
      return "SQLITE_INTERRUPT";
    case 10:
      return "SQLITE_IOERR";
    case 11:
      return "SQLITE_CORRUPT";
    case 12:
      return "SQLITE_NOTFOUND";
    case 13:
      return "SQLITE_FULL";
    case 14:
      return "SQLITE_CANTOPEN";
    case 15:
      return "SQLITE_PROTOCOL";
    case 16:
      return "SQLITE_EMPTY";
    case 17:
      return "SQLITE_SCHEMA";
    case 18:
      return "SQLITE_TOOBIG";
    case 19:
      return "SQLITE_CONSTRAINT";
    case 20:
      return "SQLITE_MISMATCH";
    case 21:
      return "SQLITE_MISUSE";
    case 22:
      return "SQLITE_NOLFS";
    case 23:
      return "SQLITE_AUTH";
    case 24:
      return "SQLITE_FORMAT";
    case 25:
      return "SQLITE_RANGE";
    case 26:
      return "SQLITE_NOTADB";
    case 27:
      return "SQLITE_NOTICE";
    case 28:
      return "SQLITE_WARNING";
    case 100:
      return "SQLITE_ROW";
    case 101:
      return "SQLITE_DONE";
    default:
      return "SQLITE_ERROR";
  }
}
