# Scriptc subset quirks

Things that look unusual and why (AGENTS.md has the rule list; this is
the field guide).

- `BsonValue` tagged union + `vX()` constructors everywhere: records of
  `unknown` can't sit in class fields or index signatures under
  scriptc (SC2006/SC1090), so the wire layer is a concrete tagged
  union; `toBsonDoc`/`fromBsonDoc` convert at the public boundary.
- `Document` = `{ [k:string]: unknown }` — the spec's recursive union
  is SC2006-refused; `unknown` is the subset-legal form of the same
  contract.
- `BsonDate` instead of `Date` on decode — native handles have no
  dynamic repr inside `unknown` slots. It's method-free: a
  `Date`-producing method trips SC9001 ("dynObjLit field value of kind
  func") once an instance crosses a dyn boundary — convert via
  `new Date(d.ms)`.
- Missing-key reads on typed records throw "record has no key" — the
  `get*`/`hasKey` helpers and the `$db`/`lsid`/URI-option reads test
  `Object.keys(rec).indexOf(key)` before indexing.
- `Collection.aggregate` returns `AggregateCursorCore`, not the
  generic interface — generic methods are signature-only through an
  interface receiver (SC1090). Annotate `AggregateCursor<TOut>` for
  typed output.
- Consumers can't `scriptc build` the package in place: `.ts` inside
  `node_modules` is SC2009-refused and the dist JS fails surface
  inference — vendor `src/` into the app (see README "Consuming under
  scriptc build").
- `CollectionCore` + `interface Collection<TDoc> extends CollectionCore`
  - `const Collection = CollectionCore` — generic class instances
    degrade to methodless shells; the interface alias keeps the typed
    surface. Same for `FindCursor<TDoc>` / `AggregateCursor<TOut>`.
- No `as unknown as` casts — SC1090. Cores are returned directly; the
  interface adds no members so they're assignable.
- `typeof doc[k] === "undefined"` is bound to a const first — `typeof`
  over index-access is SC1090.
- Transaction stamping lives in `Session.command` (`activeTxn`), not a
  collection subclass — async method overrides don't lower.
- `Map`/`Set` are allowed since scriptc 0.3.3; this package doesn't
  need them.
- `tls.connect(port, host, opts)` only — the `{socket}` upgrade form
  isn't lowered (MongoDB does first-byte TLS anyway).
- `dns.lookup(host, {family:4})` is the only DNS API — `mongodb+srv://`
  gets a best-effort A record, not real SRV resolution.
