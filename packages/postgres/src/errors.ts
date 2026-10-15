// PgError — the driver's single error class, carrying the Postgres
// ErrorResponse fields. `code` is the 5-char SQLSTATE (e.g. "23505"
// unique violation); driver-originated failures use "VALIDATION",
// "BIND_PARAM", "PROTOCOL", "CONNECTION", or a real SQLSTATE when the
// server sent one.

export interface PgErrorFields {
  code: string;
  message: string;
  severity: string;
  detail: string | null;
  hint: string | null;
  /** 1-based character position in the query, or null. */
  position: number | null;
}

export class PgError extends Error {
  /** SQLSTATE 5-char code, or a driver code (VALIDATION, PROTOCOL, ...). */
  code: string;
  /** ERROR, FATAL, or PANIC for server errors; ERROR for driver errors. */
  severity: string;
  detail: string | null;
  hint: string | null;
  position: number | null;

  constructor(fields: PgErrorFields) {
    super(fields.message);
    this.name = "PgError";
    this.code = fields.code;
    this.severity = fields.severity;
    this.detail = fields.detail;
    this.hint = fields.hint;
    this.position = fields.position;
  }
}

export function pgError(
  code: string,
  message: string,
  severity?: string,
  detail?: string | null,
  hint?: string | null,
  position?: number | null,
): PgError {
  let sev = "ERROR";
  if (typeof severity === "string" && severity.length > 0) {
    sev = severity;
  }
  let det: string | null = null;
  if (typeof detail === "string") {
    det = detail;
  }
  let hin: string | null = null;
  if (typeof hint === "string") {
    hin = hint;
  }
  let pos: number | null = null;
  if (typeof position === "number") {
    pos = position;
  }
  return new PgError({
    code: code,
    message: message,
    severity: sev,
    detail: det,
    hint: hin,
    position: pos,
  });
}
