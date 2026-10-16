// Standard-Schema seam: `schema["~standard"].validate(row)` with structural
// result handling — val returns `{ value, issues: null }`, spec-conformant
// validators return `{ value }` (issues member absent) or `{ issues }`.
// Unlike @cutils/sqlite's sync seam, this driver's surface is async, so
// Promise results are awaited — async validators work here.

import { PgError } from "./errors.ts";
import { StandardSchemaV1 } from "./types.ts";

interface StdResultLite {
  value: unknown;
  issues: unknown;
}

interface StdIssueLite {
  message: string;
}

function summarizeIssues(issues: unknown): string {
  if (typeof issues !== "object" || issues === null) {
    return "schema validation failed";
  }
  const list = issues as StdIssueLite[];
  const first = list[0];
  if (typeof first !== "object" || first === null) {
    return "schema validation failed";
  }
  let msg = first.message;
  if (typeof msg !== "string" || msg.length === 0) {
    msg = "schema validation failed";
  }
  if (list.length > 1) {
    return msg + " (+" + String(list.length - 1) + " more issues)";
  }
  return msg;
}

/**
 * Run `schema["~standard"].validate(value)`, awaiting Promise results.
 * Returns the validator's (possibly transformed) output. Throws `PgError`
 * with `code: "VALIDATION"` on failure.
 */
export async function validateRow(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const res = (await schema["~standard"].validate(value)) as unknown as StdResultLite;
  if (typeof res !== "object" || res === null) {
    throw new PgError({
      code: "VALIDATION",
      message: "validator returned a non-standard result",
      severity: "ERROR",
      detail: null,
      hint: null,
      position: null,
    });
  }
  const iss = res.issues;
  if (iss !== null && typeof iss !== "undefined") {
    throw new PgError({
      code: "VALIDATION",
      message: summarizeIssues(iss),
      severity: "ERROR",
      detail: null,
      hint: null,
      position: null,
    });
  }
  if (typeof res.value === "undefined") {
    throw new PgError({
      code: "VALIDATION",
      message: "validator returned a non-standard result",
      severity: "ERROR",
      detail: null,
      hint: null,
      position: null,
    });
  }
  return res.value;
}
