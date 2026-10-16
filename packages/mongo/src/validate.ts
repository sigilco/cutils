// Standard Schema validation seam — `schema["~standard"].validate(doc)`
// on the schema-view of the document (ObjectId -> hex, BsonDate -> ISO
// string, Binary -> Uint8Array). Sync validators return the result;
// async validators return a Promise — we await either way (subset can't
// do `instanceof Promise`).

import { mongoError } from "./errors.ts";
import { unwrapForSchema } from "./bson/value.ts";
import type { Document } from "./types.ts";
import type { StandardSchemaV1 } from "./types.ts";

export interface StdIssueLite {
  message: string;
}

export interface StdResultLite {
  value?: unknown;
  issues?: StdIssueLite[] | null;
}

function issueText(issues: StdIssueLite[]): string {
  const parts: string[] = [];
  for (let i = 0; i < issues.length; i++) {
    parts.push(issues[i].message);
  }
  return parts.join("; ");
}

/** Validate a decoded document against a Standard Schema. Throws
 * MongoError codeName "Validation" on issues; returns the (possibly
 * transformed) output. */
export async function validateDoc(schema: StandardSchemaV1, doc: Document): Promise<Document> {
  const view = unwrapForSchema(doc);
  const raw = await schema["~standard"].validate(view);
  const res = raw as StdResultLite;
  if (typeof res.issues !== "undefined" && res.issues !== null && res.issues.length > 0) {
    throw mongoError("Validation", issueText(res.issues));
  }
  if (typeof res.value !== "undefined") {
    return res.value as Document;
  }
  return doc;
}
