// Standard-Schema seam: `schema["~standard"].validate(row)` with structural
// result handling — val returns `{ value, issues: null }`, spec-conformant
// validators return `{ value }` (issues member absent) or `{ issues }`.
// A Promise result (async validator) is rejected: this FFI surface is sync.

import { SqliteError } from "./errors.ts";
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
 * Run `schema["~standard"].validate(value)` synchronously. Returns the
 * validator's (possibly transformed) output. Throws `SqliteError` with
 * `code: "VALIDATION"` on failure.
 */
export function validateRow(schema: StandardSchemaV1, value: unknown): unknown {
  const res = schema["~standard"].validate(value) as unknown as StdResultLite;
  if (typeof res !== "object" || res === null) {
    throw new SqliteError("VALIDATION", "validator returned a non-standard result");
  }
  // Promise results (async validators) land here: no `value`/`issues`
  // members, so both checks below fail into the non-standard throw.
  const iss = res.issues;
  if (iss !== null && typeof iss !== "undefined") {
    throw new SqliteError("VALIDATION", summarizeIssues(iss));
  }
  if (typeof res.value === "undefined") {
    throw new SqliteError(
      "VALIDATION",
      "validator returned a non-standard result (async validators are not supported)",
    );
  }
  return res.value;
}
