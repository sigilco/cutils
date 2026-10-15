// Public value/row types and the Standard Schema v1 seam types.
//
// The Standard Schema types are a LOCAL MIRROR of `@standard-schema/spec`,
// not an import: scriptc 0.3.3 refuses to analyze the spec package's shipped
// JS even for a type-only import, so the package owns a structural copy of
// the spec surface (props + validate signature + InferOutput inference).
// Structurally every conforming validator satisfies it — `@chttp/val` schemas,
// valibot schemas, anything with `~standard.validate`.

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
 * signatures are compatible. Async validators are rejected at call time.
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

/** A value SQLite can store / return. */
export type SqlValue = number | bigint | string | null | Uint8Array;
/** A bindable value; booleans bind as INTEGER 0/1. */
export type BindValue = SqlValue | boolean;
/** A row as returned by `get`/`all` before schema validation. */
export type Row = Record<string, SqlValue>;
/** Write-side parameters for named binds (`@x`, `:x`, `$x`). */
export type BindRecord = Record<string, BindValue>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface OpenOpts {
  /** Open read-only (fails if the file does not exist). */
  readonly?: boolean;
  /** Fail instead of creating the file when it does not exist. */
  fileMustExist?: boolean;
}

export interface ColumnInfo {
  /** Column name as the statement returns it. */
  name: string;
  /** Origin column name, or null for expressions / metadata off. */
  column: string | null;
  /** Origin table name. */
  table: string | null;
  /** Origin database name ("main", "temp", or an ATTACH alias). */
  database: string | null;
  /** Declared column type from the DDL, or null for expressions. */
  type: string | null;
}
