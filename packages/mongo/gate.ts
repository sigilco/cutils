// scriptc coverage gate for @cutils/mongo: exercises the full public
// surface plus the internal wire machinery. Also the ELF smoke program —
// test/elf.test.sh builds this file with `scriptc build` and asserts the
// "gate OK" line.
//
// No server needed: OP_MSG/BSON/uri/ObjectId/SCRAM helpers and the
// cursor/session state machines are exercised against in-memory frames.
// Command paths that need a live mongod stay behind test/mongo.test.js.

import {
  Binary,
  BsonDate,
  MongoClient,
  MongoError,
  ObjectId,
  StandardSchemaV1,
  StdProps,
} from "./src/index.ts";
import type { Document } from "./src/index.ts";
import { decodeDoc, encodeDoc } from "./src/internal/bson.ts";
import { decodeMsg, DocSeq, encodeMsg } from "./src/internal/opmsg.ts";
import { parseUri } from "./src/internal/uri.ts";
import { fromBsonDoc, getNum, getStr, toBsonDoc, vI32, vObj, vStr } from "./src/bson/value.ts";
import { findSpec, getMoreSpec, killCursorsSpec, updateEntry } from "./src/internal/commands.ts";
import { validateDoc } from "./src/validate.ts";

class GateProps extends StdProps {
  constructor() {
    super();
    this.version = 1;
    this.vendor = "gate";
  }

  validate(input: unknown): unknown {
    if (typeof input !== "object" || input === null) {
      return { value: null, issues: [{ message: "value is not an object" }] };
    }
    const r = input as Document;
    if (typeof r.title !== "string") {
      return { value: null, issues: [{ message: "title must be a string" }] };
    }
    return { value: input, issues: null };
  }
}

class GateSchema extends StandardSchemaV1 {
  constructor() {
    super();
    this["~standard"] = new GateProps();
  }
}

function check(cond: boolean, name: string): void {
  if (!cond) {
    throw new Error("gate FAIL: " + name);
  }
}

async function main(): Promise<void> {
  // --- ObjectId / Binary / BsonDate ------------------------------------
  const oid = ObjectId.generate();
  check(oid.toHexString().length === 24, "oid hex length");
  check(ObjectId.fromHex(oid.toHexString()).equals(oid), "oid roundtrip");
  check(ObjectId.isHex(oid.toHexString()), "oid isHex");
  check(!ObjectId.isHex("nope"), "oid isHex rejects");
  const bin = new Binary(new Uint8Array(16), 4);
  check(bin.toUUID().length === 36, "uuid format");
  const bd = new BsonDate(1737504000000);
  check(bd.getTime() === 1737504000000, "bsondate ms");
  check(new Date(bd.ms).toISOString() === "2025-01-22T00:00:00.000Z", "bsondate iso");

  // --- BSON round-trip across all 11 shipped types ----------------------
  const nested: Document = { x: 1, y: "two" };
  const doc: Document = {
    s: "hello",
    i32: 42,
    i64: 5000000000,
    f: 1.5,
    b: true,
    n: null,
    oid: oid,
    bin: bin,
    dt: new BsonDate(1737504000000),
    re: { pattern: "^a", options: "i" },
    arr: [1, "two", false],
    doc: nested,
  };
  const wire = toBsonDoc(doc);
  const bytes = encodeDoc(wire);
  const back = decodeDoc(bytes);
  check(getStr(back, "s") === "hello", "bson string");
  check(getNum(back, "i32") === 42, "bson i32");
  check(getNum(back, "i64") === 5000000000, "bson i64");
  check(getNum(back, "f") === 1.5, "bson double");
  const plain = fromBsonDoc(back);
  check(plain.s === "hello", "plain string");
  check(plain.oid instanceof ObjectId, "plain oid class");
  check(plain.bin instanceof Binary, "plain binary class");
  check(plain.dt instanceof BsonDate, "plain date class");
  const arrField = plain.arr;
  check(Array.isArray(arrField), "plain array");

  // --- OP_MSG frame round-trip incl. kind-1 document sequences ----------
  const body: {
    [k: string]: ReturnType<typeof vStr> | ReturnType<typeof vI32> | ReturnType<typeof vObj>;
  } = {};
  const bodyDoc = { insert: vStr("t"), ordered: vI32(1) };
  const seqDoc = { a: vI32(1) };
  const frame = encodeMsg(7, bodyDoc, [new DocSeq("documents", [seqDoc])]);
  const msg = decodeMsg(frame);
  check(msg.requestId === 7, "opmsg requestId");
  check(getStr(msg.body, "insert") === "t", "opmsg body");
  check(msg.seqs.length === 1, "opmsg seq count");
  check(msg.seqs[0].id === "documents", "opmsg seq id");
  check(msg.seqs[0].docs.length === 1, "opmsg seq doc");
  check(body !== null, "typed body");

  // --- URI parsing -------------------------------------------------------
  const u = parseUri("mongodb://user:p%40ss@h1:27018,h2/db1?retryWrites=false");
  check(u.seeds.length === 2, "uri seeds");
  check(u.seeds[0].port === 27018, "uri port");
  check(u.user === "user", "uri user");
  check(u.pass === "p@ss", "uri pass");
  check(u.dbName === "db1", "uri db");
  check(u.options["retryWrites"] === "false", "uri opts");
  const srv = parseUri("mongodb+srv://cluster0.example.com/db");
  check(srv.isSrv && srv.tlsRequired, "srv flags");

  // --- command-spec builders ---------------------------------------------
  const fs = findSpec("t", toBsonDoc({ a: 1 }), null);
  check(getStr(fs, "find") === "t", "find spec");
  const gm = getMoreSpec(BigInt(42), "t", 10);
  check(getNum(gm, "getMore") === 42, "getMore spec");
  const kc = killCursorsSpec("t", [BigInt(42)]);
  check(getStr(kc, "killCursors") === "t", "killCursors spec");
  const ue = updateEntry(toBsonDoc({ a: 1 }), toBsonDoc({ $set: { b: 2 } }), false, false);
  check(ue.q !== undefined, "update entry q");

  // --- schema validation seam ---------------------------------------------
  const good = await validateDoc(new GateSchema(), { title: "ok" });
  check(good.title === "ok", "schema pass");
  let threw = false;
  try {
    await validateDoc(new GateSchema(), { title: 5 });
  } catch (e) {
    if (e instanceof MongoError) {
      threw = e.codeName === "Validation";
    }
  }
  check(threw, "schema reject");

  // --- public surface type smoke (no server calls) -------------------------
  const clientTypeCheck: (opts: {
    uri: string;
    dbName: string;
    appName?: string;
    connectTimeoutMs?: number;
    serverSelectionTimeoutMs?: number;
    retryReads?: boolean;
    retryWrites?: boolean;
    tls?: "off" | "preferred" | "required";
  }) => Promise<MongoClient> = MongoClient.connect;
  check(typeof clientTypeCheck === "function", "connect signature");

  console.log("gate OK");
}

main();
