// Public types and the Standard Schema v1 seam for @cutils/mongo.
//
// The Standard Schema types are a LOCAL MIRROR of `@standard-schema/spec`
// (same reasoning as @cutils/sqlite): scriptc refuses even `import type` of
// the spec package, and the seam is stored on class fields so it must be a
// class — interface-typed fields erase to `unknown` (SC1090). Every
// conforming validator (@chttp/val, valibot, zod/v4-standard) satisfies the
// shape structurally.
//
// `Document` is `{ [k: string]: unknown }`, not the recursive union the
// spec sketches: `BsonPrimitive | Document | BsonPrimitive[]` is an index
// signature over class-arm unions, which scriptc refuses (SC2006). The
// public contract is identical — any BSON-representable value flows
// through `unknown`.

/** Standard Typed `types` member shape (valibot-style). */
export interface StdTypes<Input, Output> {
  input: Input;
  output: Output;
}

/** Standard Schema `~standard` props — a class so it can sit in class
 * fields without erasing to `unknown`. `validate` returns `unknown` so
 * both sync and async validator signatures are assignable; callers await
 * the result either way. */
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

/** Row output inference through the optional `types` member. */
export type InferOutput<S extends StandardSchemaV1> = S extends {
  "~standard": { types: { output: infer O } };
}
  ? O
  : unknown;

/** A value a MongoDB document can hold (user-facing type view). */
export type BsonPrimitive =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | ObjectId
  | Binary
  | BsonDate;

/** A MongoDB document. `unknown` members are the subset-clean form of the
 * spec's recursive `BsonPrimitive | Document | BsonPrimitive[]` union. */
export type Document = { [k: string]: unknown };

export type WithId<T> = T & { _id: ObjectId };
export type WithoutId<T> = Omit<T, "_id">;

import type { Binary } from "./bson/binary.ts";
import type { BsonDate } from "./bson/value.ts";
import type { ObjectId } from "./bson/objectid.ts";

export interface ConnectOpts {
  /** `mongodb://host[:port]` or `mongodb+srv://host` connection string. */
  uri: string;
  /** Logical default database (also the default authSource). */
  dbName: string;
  appName?: string;
  /** Default 10000. */
  connectTimeoutMs?: number;
  /** Default 30000. */
  serverSelectionTimeoutMs?: number;
  /** Default true — one retry of idempotent reads on a network error. */
  retryReads?: boolean;
  /** Default true — one retry of writes on a network error (never in a tx). */
  retryWrites?: boolean;
  /** Default "preferred" — `mongodb+srv://` forces "required". */
  tls?: "off" | "preferred" | "required";
}

export type ReadPreference =
  | "primary"
  | "primaryPreferred"
  | "secondary"
  | "secondaryPreferred"
  | "nearest";

export interface FindOpts {
  projection?: { [k: string]: 0 | 1 };
  sort?: { [k: string]: 1 | -1 };
  limit?: number;
  skip?: number;
  maxTimeMs?: number;
  batchSize?: number;
  readPreference?: ReadPreference;
}

export type WriteOp<TDoc> =
  | { type: "insert"; doc: WithoutId<TDoc> }
  | { type: "updateOne"; filter: Partial<TDoc>; update: Document; upsert?: boolean }
  | { type: "updateMany"; filter: Partial<TDoc>; update: Document; upsert?: boolean }
  | { type: "deleteOne"; filter: Partial<TDoc> }
  | { type: "deleteMany"; filter: Partial<TDoc> }
  | {
      type: "replaceOne";
      filter: Partial<TDoc>;
      replacement: WithoutId<TDoc>;
      upsert?: boolean;
    };

export interface BulkWriteResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  deletedCount: number;
}

export interface TransactionOpts {
  readConcern?: "local" | "majority" | "snapshot";
  writeConcern?: "majority" | { w: number; j?: boolean };
}
