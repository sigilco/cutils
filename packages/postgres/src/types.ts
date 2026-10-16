// Public value/row types and the Standard Schema v1 seam types.
//
// The Standard Schema types are a LOCAL MIRROR of `@standard-schema/spec`,
// not an import: scriptc 0.3.3 refuses to analyze the spec package's shipped
// JS even for a type-only import, so the package owns a structural copy of
// the spec surface (props + validate signature + InferOutput inference).
// Structurally every conforming validator satisfies it — `@chttp/val` schemas,
// valibot schemas, anything with `~standard.validate`. Same approach as
// @cutils/sqlite's types.ts.

/** Standard Typed `types` member shape (valibot-style). */
export interface StdTypes<Input, Output> {
  input: Input;
  output: Output;
}

/**
 * Standard Schema `~standard` props — a CLASS, not an interface:
 * interface-typed class fields erase to `unknown` under scriptc (SC1090),
 * so the seam shape is declared as classes (the same trick `@chttp/val`
 * uses). Structurally every conforming validator still satisfies it:
 * `version` is `number` (not literal `1`, so `@chttp/val`'s
 * `version: number` field assigns) and `validate` returns `unknown` so
 * both sync results and spec-conformant `Result | Promise<Result>`
 * signatures are compatible.
 */
export class StdProps {
  version: number = 0;
  vendor: string = "";

  validate(input: unknown): unknown {
    return { value: input, issues: null };
  }
}

/** Standard Schema v1 shape (local mirror of the spec). */
export class StandardSchemaV1 {
  "~standard": StdProps = new StdProps();
}

/**
 * Row output inference: reads the optional `types` member when the schema
 * carries it (valibot and other spec-complete validators), else `unknown`
 * (`@chttp/val` today — its coarse inference is a val-side ticket).
 */
export type InferOutput<S extends StandardSchemaV1> = S extends {
  "~standard": { types: { output: infer O } };
}
  ? O
  : unknown;

/** A value Postgres can store / return. */
// NOTE — spec deviation: the plan typed `Date` into this union, but no union
// with a `Date` arm compiles under scriptc 0.3.3 (SC2009: no runtime
// narrowing against sibling arms). Timestamps round-trip as ISO-8601 UTC
// strings; `new Date(v)` at the call site recovers a Date when wanted.
export type SqlValue = number | bigint | string | boolean | null | Uint8Array;
/** A bindable parameter value (text-format encoded on the wire). */
export type BindValue = SqlValue;
/** A row as returned by `get`/`all` before schema validation. */
export type Row = Record<string, SqlValue>;
/** Write-side parameters for named binds (`:name`, `@name`, `$name`). */
export type BindRecord = Record<string, BindValue>;

export interface RunResult {
  /** Rows affected as reported by CommandComplete (0 when not applicable). */
  rowCount: number;
}

export interface ConnectOpts {
  host: string;
  /** Server port; default 5432. */
  port?: number;
  user: string;
  password: string;
  /** Database name. */
  database: string;
  /**
   * TLS policy. Only `"disable"` compiles under scriptc 0.3.3 — the
   * toolchain does not lower `node:tls` sockets yet, so `"require"` and
   * `"verify-full"` throw `PgError` code `0A000` (feature not supported).
   */
  ssl?: "disable" | "require" | "verify-full";
  /** Sent in the startup packet; shows up in `pg_stat_activity`. */
  applicationName?: string;
  /** Connect timeout in ms; default 10000. */
  connectTimeoutMs?: number;
  /** `statement_timeout` applied after connect, in ms; default 0 (none). */
  statementTimeoutMs?: number;
}

export interface ColumnInfo {
  /** Column name as RowDescription reports it. */
  name: string;
  /** Origin column name, or null for expressions. */
  column: string | null;
  /** Origin table name, or null for expressions / catalog lookup off. */
  table: string | null;
  /** Origin schema name, or null. */
  schema: string | null;
  /** Origin database name (the connected database). */
  database: string | null;
  /** Type name from the OID registry (e.g. "int4", "timestamptz"). */
  type: string | null;
  /** NOT NULL flag from the pg_attribute catalog lookup, false when unknown. */
  notNull: boolean;
  /** Default expression from pg_attrdef, or null. */
  default: string | null;
}

/** A drained LISTEN/NOTIFY event from `Database.notify`. */
export interface NotifyEvent {
  channel: string;
  payload: string;
  /** Backend PID of the notifying connection. */
  pid: number;
}
