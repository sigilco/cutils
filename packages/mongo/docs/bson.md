# BSON

11 types shipped, 7 punted.

| BSON type | encode from                                | decode to                   |
| --------- | ------------------------------------------ | --------------------------- |
| double    | `number` (non-integer)                     | `number`                    |
| string    | `string`                                   | `string`                    |
| object    | `Document`                                 | `Document`                  |
| array     | `unknown[]`                                | `unknown[]`                 |
| binary    | `Uint8Array`, `Binary`                     | `Binary`                    |
| objectId  | `ObjectId`                                 | `ObjectId`                  |
| boolean   | `boolean`                                  | `boolean`                   |
| date      | `Date`, `BsonDate`, `{ $bson: "date", v }` | `BsonDate`                  |
| null      | `null`                                     | `null`                      |
| regex     | `RegExp`, `{ pattern, options }`           | `{ pattern, options }`      |
| int32     | `number` (int, <= 2^31)                    | `number`                    |
| int64     | `number` (int, > 2^31), `bigint`           | `number` (lossy above 2^53) |

Integer numbers encode as int32 when they fit, int64 when they fit in
the safe-integer range, double otherwise.

## BsonDate

A `Date` can't live in an `unknown` record slot under scriptc, so
decoded dates are `BsonDate { ms, getTime() }`.
Encode accepts all three forms — under plain Node `new Date()` works,
in-subset pass `BsonDate` or the tagged record. Convert a decoded
`BsonDate` with `new Date(d.ms)` or `new Date(d.ms).toISOString()` —
`BsonDate` is method-free on purpose: a `Date`-producing method on the
class trips SC9001 under scriptc when the instance crosses a dyn
boundary.

## int64

Wire int64s carry the full `bigint` internally (`raw` on the tagged
value) and encode/decode losslessly on the wire. The user-facing view
is `number` — exact below 2^53, rounded above. If you need >2^53
integers, keep them as strings or fetch via `db.command`.

## Punted types

decimal128, timestamp, dbRef, symbol, code/codeWithScope, minKey,
maxKey: the decoder skips their bytes and the field reads as `null`.
The encoder never emits them — pass the value through `db.command` with
the tagged `BsonValue` machinery if you must write one.
