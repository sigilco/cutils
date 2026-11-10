// Consumer-side ELF program for @cutils/mongo: exercises the published
// "./elf" entry exactly as a consumer's `scriptc build --npm-static`
// would — connect to the canned wire server, run a find, print a row.
import { MongoClient } from "@cutils/mongo/elf";

const port = Number(process.argv[2] || "0");
const client = await MongoClient.connect({
  uri: "mongodb://127.0.0.1:" + port,
  dbName: "smoke",
  appName: "consumer-elf",
  connectTimeoutMs: 5000,
});
const coll = client.database().collection("todos");
const doc = await coll.findOne({});
if (doc === null) {
  throw new Error("findOne returned null");
}
console.log("consumer OK", doc.title);
await client.close();
