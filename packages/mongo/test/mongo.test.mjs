// mongo.test.mjs — live integration against mongod. Runs only when
// MONGO_TEST_URI is set (e.g. `mongodb://localhost:27017` from
// `docker run -d -p 27017:27017 mongo:7`); skips cleanly otherwise.

import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient, MongoError, ObjectId } from "../dist/esm/index.js";

const URI = process.env.MONGO_TEST_URI;
const it = URI ? test : test.skip;
const DB = "cutils_mongo_test";

it("connect, insert, find, update, delete, aggregate, count, distinct, bulkWrite, txn", async () => {
  const client = await MongoClient.connect({ uri: URI, dbName: DB, appName: "cutils-test" });
  const coll = client.database().collection("todos");
  await coll.deleteMany({});

  // insertOne + generated _id
  const id = await coll.insertOne({ title: "one", done: false, n: 1 });
  assert.ok(id instanceof ObjectId);
  assert.equal(id.toHexString().length, 24);

  // insertMany
  const ids = await coll.insertMany([
    { title: "two", done: false, n: 2 },
    { title: "three", done: true, n: 3 },
  ]);
  assert.equal(ids.length, 2);

  // findOne
  const one = await coll.findOne({ title: "one" });
  assert.equal(one.title, "one");
  assert.ok(one._id instanceof ObjectId);

  // find + cursor surface
  const cursor = coll.find({}, { sort: { n: 1 } });
  const all = await cursor.all();
  assert.equal(all.length, 3);
  assert.equal(all[0].title, "one");
  assert.equal(all[2].title, "three");

  // findOne returns null on miss
  assert.equal(await coll.findOne({ title: "nope" }), null);

  // updateOne / updateMany
  assert.equal(await coll.updateOne({ title: "one" }, { $set: { done: true } }), 1);
  assert.equal(await coll.updateMany({}, { $set: { tag: "x" } }), 3);

  // findOneAndUpdate returns the new doc; findOneAndDelete returns old
  const updated = await coll.findOneAndUpdate({ title: "two" }, { $set: { n: 22 } });
  assert.equal(updated.n, 22);
  const deleted = await coll.findOneAndDelete({ title: "three" });
  assert.equal(deleted.title, "three");

  // deleteOne / deleteMany
  await coll.insertMany([{ tmp: 1 }, { tmp: 2 }]);
  assert.equal(await coll.deleteOne({ tmp: 1 }), 1);
  assert.equal(await coll.deleteMany({ tmp: { $exists: true } }), 1);

  // count / estimated / distinct
  assert.equal(await coll.countDocuments({ tag: "x" }), 2);
  assert.ok((await coll.estimatedDocumentCount()) >= 2);
  const tags = await coll.distinct("tag");
  assert.deepEqual(tags, ["x"]);

  // bulkWrite across op kinds
  const bw = await coll.bulkWrite([
    { type: "insert", doc: { b: 1 } },
    { type: "updateOne", filter: { title: "one" }, update: { $set: { b: 2 } } },
    { type: "deleteOne", filter: { title: "two" } },
  ]);
  assert.equal(bw.insertedCount, 1);
  assert.equal(bw.matchedCount, 1);
  assert.equal(bw.deletedCount, 1);

  // aggregate
  const agg = await coll.aggregate([{ $group: { _id: null, total: { $sum: "$b" } } }]).all();
  assert.ok(agg.length >= 1);

  // duplicate-key error surfaces code + codeName
  let dup = null;
  try {
    await coll.insertOne({ _id: id, title: "dupe" });
  } catch (e) {
    dup = e;
  }
  assert.ok(dup instanceof MongoError);
  assert.equal(dup.code, 11000);
  assert.equal(dup.codeName, "DuplicateKey");

  // transaction commit + rollback (replica set required; standalone skips)
  try {
    const txn = client.startTransaction();
    try {
      await txn.database(DB).collection("todos").insertOne({ title: "intx" });
      await txn.commit();
    } finally {
      await txn.close();
    }
    const rb = client.startTransaction();
    try {
      await rb.database(DB).collection("todos").insertOne({ title: "rollback-me" });
      await rb.rollback();
    } finally {
      await rb.close();
    }
    assert.equal(await coll.findOne({ title: "rollback-me" }), null);
  } catch (e) {
    if (e instanceof MongoError && e.codeName === "IllegalOperation") {
      // standalone mongod — transactions unsupported, acceptable
    } else {
      throw e;
    }
  }

  // db.command passthrough
  const ping = await client.database().command({ ping: 1 });
  assert.equal(ping.ok, 1);

  await client.close();
});
