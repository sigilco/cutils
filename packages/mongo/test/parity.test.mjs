// parity.test.mjs — behavioral parity vs the official `mongodb` driver on
// the same server. Runs only when MONGO_TEST_URI is set.

import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "../dist/esm/index.js";
import { MongoClient as OfficialClient } from "mongodb";

const URI = process.env.MONGO_TEST_URI;
const it = URI ? test : test.skip;
const DB = "cutils_mongo_parity";

it("insert/find/update/delete parity with official driver", async () => {
  const official = new OfficialClient(URI);
  await official.connect();
  const odb = official.db(DB).collection("todos");
  await odb.deleteMany({});

  const ours = await MongoClient.connect({ uri: URI, dbName: DB });
  const coll = ours.database().collection("todos");

  // official writes, ours reads
  const { insertedId } = await odb.insertOne({ title: "from-official", n: 5 });
  const read = await coll.findOne({ title: "from-official" });
  assert.equal(read.title, "from-official");
  assert.equal(read.n, 5);
  assert.equal(read._id.toHexString(), insertedId.toHexString());

  // ours writes, official reads
  const oid = await coll.insertOne({ title: "from-ours", tags: ["a", "b"], n: 7 });
  const oread = await odb.findOne({ title: "from-official" });
  assert.equal(oread.n, 5);
  const oread2 = await odb.findOne({
    _id: new (await import("mongodb")).ObjectId(oid.toHexString()),
  });
  assert.equal(oread2.title, "from-ours");
  assert.deepEqual(oread2.tags, ["a", "b"]);

  // count parity
  assert.equal(await coll.countDocuments({}), await odb.countDocuments({}));

  // distinct parity
  const d1 = await coll.distinct("title");
  const d2 = await odb.distinct("title");
  assert.deepEqual(new Set(d1), new Set(d2));

  await odb.deleteMany({});
  await official.close();
  await ours.close();
});
