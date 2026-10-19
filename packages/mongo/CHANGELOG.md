# @cutils/mongo

## 0.4.0

### Minor Changes

- mongo!: BsonDate drops its Date-producing methods (SC9001 on dyn boxing); aggregate() returns the concrete AggregateCursorCore — generic methods are signature-only through the Collection interface

### Patch Changes

- mongo: guard missing-key reads on typed records — scriptc throws 'record has no key' instead of yielding undefined

- mongo: keep int64 cursor ids lossless — getMore/killCursors re-encode the raw bigint, fixing CursorNotFound on multi-batch cursors (#32)

- mongo: insertOne builds the generated-_id document via toBsonDoc — direct tagged-literal store trips SC9001 under scriptc

- mongo: omit startTransaction when false — mongod >=8 rejects the field outright

- mongo: replace String.lastIndexOf in URI parsing — unsupported when the published dist is compiled by scriptc 0.3.4

## 0.3.0

## 0.2.0

### Minor Changes

- feat(mongo): hand-rolled async MongoDB wire driver (OP_MSG + BSON, no FFI)
