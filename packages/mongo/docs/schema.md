# Schema validation

`client.withSchema(schema)` binds a Standard Schema v1 validator to a
`Database`. Every document read through it (`findOne`, cursor `next`/
`all`/`forEach`, `findOneAndUpdate`, `findOneAndDelete`, `aggregate`)
is validated; a failed validation throws `MongoError` with
`codeName: "Validation"`.

```ts
import * as v from "@chttp/val";

const Todo = v.strictObject({
  _id: v.string(),          // ObjectId -> hex string
  title: v.string(),
  done: v.boolean(),
});

const db = client.withSchema(Todo);
const todos = db.collection<Todo>("todos");
const row = await todos.findOne({ title: "x" }); // validated
```

The validated value is the schema's `output` — the plain-TS view of the
document: `ObjectId` → hex string, `BsonDate` → ISO string, `Binary` →
`Uint8Array`. `InferOutput<typeof schema>` types the results.

In-subset schemas extend the shipped `StandardSchemaV1`/`StdProps`
classes (structural siblings can't widen across class bounds) —
see `gate.ts` for the pattern. Plain-Node consumers use any
conforming library as-is.
