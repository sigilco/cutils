// Command-spec builders: user-facing Collection methods lower to OP_MSG
// command documents (find/insert/update/delete/getMore/killCursors/
// aggregate/count/distinct/findAndModify + txn commands) built here.

import type { BsonDoc, BsonValue } from "../bson/value.ts";
import { vArr, vBool, vI32, vI64, vObj, vStr } from "../bson/value.ts";
import type { FindOpts } from "../types.ts";

export function findSpec(coll: string, filter: BsonDoc, opts: FindOpts | null): BsonDoc {
  const spec: BsonDoc = {};
  spec["find"] = vStr(coll);
  spec["filter"] = vObj(filter);
  if (opts !== null) {
    if (typeof opts.projection !== "undefined") {
      const p: BsonDoc = {};
      const keys = Object.keys(opts.projection);
      for (let i = 0; i < keys.length; i++) {
        p[keys[i]] = vI32(opts.projection[keys[i]]);
      }
      spec["projection"] = vObj(p);
    }
    if (typeof opts.sort !== "undefined") {
      const s: BsonDoc = {};
      const keys = Object.keys(opts.sort);
      for (let i = 0; i < keys.length; i++) {
        s[keys[i]] = vI32(opts.sort[keys[i]]);
      }
      spec["sort"] = vObj(s);
    }
    if (typeof opts.limit !== "undefined") {
      spec["limit"] = vI64(opts.limit);
    }
    if (typeof opts.skip !== "undefined") {
      spec["skip"] = vI64(opts.skip);
    }
    if (typeof opts.maxTimeMs !== "undefined") {
      spec["maxTimeMS"] = vI64(opts.maxTimeMs);
    }
    if (typeof opts.batchSize !== "undefined") {
      spec["batchSize"] = vI64(opts.batchSize);
    }
    if (typeof opts.readPreference !== "undefined") {
      const rp: BsonDoc = {};
      rp["mode"] = vStr(opts.readPreference);
      spec["$readPreference"] = vObj(rp);
    }
  }
  return spec;
}

export function insertSpec(coll: string): BsonDoc {
  const spec: BsonDoc = {};
  spec["insert"] = vStr(coll);
  spec["ordered"] = vBool(true);
  return spec;
}

export function updateSpec(coll: string): BsonDoc {
  const spec: BsonDoc = {};
  spec["update"] = vStr(coll);
  spec["ordered"] = vBool(true);
  return spec;
}

export function deleteSpec(coll: string): BsonDoc {
  const spec: BsonDoc = {};
  spec["delete"] = vStr(coll);
  spec["ordered"] = vBool(true);
  return spec;
}

export function updateEntry(q: BsonDoc, u: BsonDoc, upsert: boolean, multi: boolean): BsonDoc {
  const e: BsonDoc = {};
  e["q"] = vObj(q);
  e["u"] = vObj(u);
  e["upsert"] = vBool(upsert);
  e["multi"] = vBool(multi);
  return e;
}

export function deleteEntry(q: BsonDoc, limit: number): BsonDoc {
  const e: BsonDoc = {};
  e["q"] = vObj(q);
  e["limit"] = vI32(limit);
  return e;
}

export function getMoreSpec(cursorId: number, coll: string, batchSize: number | null): BsonDoc {
  const spec: BsonDoc = {};
  spec["getMore"] = vI64(cursorId);
  spec["collection"] = vStr(coll);
  if (batchSize !== null) {
    spec["batchSize"] = vI64(batchSize);
  }
  return spec;
}

export function killCursorsSpec(coll: string, ids: number[]): BsonDoc {
  const spec: BsonDoc = {};
  spec["killCursors"] = vStr(coll);
  const arr: BsonValue[] = [];
  for (let i = 0; i < ids.length; i++) {
    arr.push(vI64(ids[i]));
  }
  spec["cursors"] = vArr(arr);
  return spec;
}

export function aggregateSpec(coll: string, pipeline: BsonDoc[]): BsonDoc {
  const spec: BsonDoc = {};
  spec["aggregate"] = vStr(coll);
  const arr: BsonValue[] = [];
  for (let i = 0; i < pipeline.length; i++) {
    arr.push(vObj(pipeline[i]));
  }
  spec["pipeline"] = vArr(arr);
  const cursor: BsonDoc = {};
  spec["cursor"] = vObj(cursor);
  return spec;
}

export function countSpec(coll: string, filter: BsonDoc): BsonDoc {
  const spec: BsonDoc = {};
  spec["count"] = vStr(coll);
  spec["query"] = vObj(filter);
  return spec;
}

export function distinctSpec(coll: string, key: string, filter: BsonDoc): BsonDoc {
  const spec: BsonDoc = {};
  spec["distinct"] = vStr(coll);
  spec["key"] = vStr(key);
  spec["query"] = vObj(filter);
  return spec;
}

export function findAndModifySpec(
  coll: string,
  filter: BsonDoc,
  update: BsonDoc | null,
  remove: boolean,
  returnNew: boolean,
): BsonDoc {
  const spec: BsonDoc = {};
  spec["findAndModify"] = vStr(coll);
  spec["query"] = vObj(filter);
  if (update !== null) {
    spec["update"] = vObj(update);
  }
  spec["remove"] = vBool(remove);
  spec["new"] = vBool(returnNew);
  return spec;
}

export function txnFields(
  spec: BsonDoc,
  lsid: BsonDoc,
  txnNumber: number,
  start: boolean,
  autocommit: boolean,
): void {
  spec["lsid"] = vObj(lsid);
  spec["txnNumber"] = vI64(txnNumber);
  spec["startTransaction"] = vBool(start);
  spec["autocommit"] = vBool(autocommit);
}

export function commitTxnSpec(): BsonDoc {
  const spec: BsonDoc = {};
  spec["commitTransaction"] = vI32(1);
  return spec;
}

export function abortTxnSpec(): BsonDoc {
  const spec: BsonDoc = {};
  spec["abortTransaction"] = vI32(1);
  return spec;
}
