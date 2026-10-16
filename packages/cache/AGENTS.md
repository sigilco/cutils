# cache AGENTS.md

`@cutils/cache` — Map-based LRU+TTL memory cache with lru-cache-parity semantics, in the scriptc compilable subset. Same subset rules as the root AGENTS.md, plus the constraints discovered while authoring this package:

- **`Map` is legal here by probe-verified exception** (0.3.3 lifted the Map/Set ban for this package's LRU). It is still banned in other packages unless their own AGENTS.md documents a probe.
- **`Cache<V>` is a phantom-generic type alias, not a class.** Generic class parameters degrade instances to methodless shells — the runtime class is non-generic `CacheCore`, exported as `interface Cache<V> extends CacheCore {}` + `const Cache = CacheCore` (the `Ctx<P>`/`ReqView<P>` pattern). Do NOT narrow `get`/`peek`/`set` on the interface to mention `V`: a member signature that references the type parameter refuses to lower at the call site (SC1090). `get`/`peek` return `unknown | null`; narrowing to `V` is the caller's job.
- **A generic construct signature is equally poison.** `const Cache = CacheCore as unknown as new <V>(...) => Cache<V>` produces `Cache<V>`-typed locals whose methods degrade — same SC1090. Keep `const Cache = CacheCore` plain.
- **`now` is a positional constructor parameter, never an options-record member.** `CacheOptions`/`CacheSetOptions` are plain records; a function-typed member would degrade their instantiation. The test seam stays `new Cache(opts, () => t)`.
- **`unknown` lives in the `CacheEntry` record only.** Class fields are concrete (`Map<string, CacheEntry>`, `number`, `() => number`); arbitrary values flow through parameters/returns/plain-record members.
- **Eviction reads the Map's first key via one `for...of` over `entries()` + immediate `break`.** No `.next()` calls; iteration order = insertion order is spec behavior and the probe verified it in the ELF.
- **`set` must `delete` before `set` on an existing key** — Map preserves position on overwrite, and re-set keys must land at MRU.
- **`delete` is a legal method name** but reads oddly in grep; it is `store.delete` inside.
- **`scriptc coverage packages/cache/gate.ts` must stay at 100%** (via `scripts/scriptc-gate.sh`), and `test/elf.test.sh` must keep passing — 0.3.3 defers some fences to runtime, so the build+run is the real gate.
- `scriptc` reports ANY program type error as `SC2013 cannot compile npm package '<pkg>' statically`, blaming an npm import even when the package is fine. When a consumer sees it, run `tsc --noEmit` first.

## lru-cache divergences (keep the README table in sync)

| lru-cache                                                     | @cutils/cache                                                       | Why                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `get`/`peek` return `V \| undefined`                          | `V \| null` (`unknown \| null` on the class)                        | SC3004 bans `\| undefined`; `has()` disambiguates stored-null |
| `class LRUCache<K, V>`                                        | `Cache<V>` phantom alias over `CacheCore`; keys are always `string` | generic class params degrade to methodless shells             |
| `ttlAutopurge`, timers                                        | lazy purge on access only                                           | no timers; `max` bounds memory                                |
| `dispose`, `fetch`, `sizeCalculation`, stale-while-revalidate | not shipped                                                         | follow-up tickets if a demand case appears                    |
| `mget`/`mset`                                                 | loop `get`/`set`                                                    | belongs to a store-seam backend, not memory                   |
| `updateAgeOnGet`, `allowStale`, `noDeleteOnStaleGet`          | not shipped                                                         | stale reads don't exist: expiry purges eagerly on access      |
| `ttl: 0` = "no expiry"                                        | non-positive `ttl`/`max` throws `E_BAD_CACHE_OPTIONS`               | fail fast on config, never on traffic                         |
