# @chttp/cache

Map-based LRU + TTL in-process memory cache with [lru-cache](https://github.com/isaacs/node-lru-cache)-parity semantics, authored inside the [scriptc](https://github.com/vercel-labs/scriptc) compilable subset — it compiles into a native ELF alongside a [chttp](https://github.com/sigilco/chttp) app with `scriptc build`, and runs under Node unchanged.

```ts
import { Cache } from "@chttp/cache";

const sessions: Cache<string> = new Cache({ max: 10_000, ttl: 60_000 });

sessions.set("sess-1", "uid:42");
sessions.get("sess-1"); // "uid:42" — and bumps recency
sessions.has("sess-1"); // true — no recency bump
sessions.peek("sess-1"); // "uid:42" — no recency bump
sessions.get("missing"); // null — misses are null, never undefined
```

- **`get` bumps recency; `peek`/`has` don't.** Recency decides which entry evicts when `size > max`.
- **TTL is lazy.** Expired entries purge on access (`get`/`has`/`peek`), never on a timer. An expired entry nobody reads holds memory until evicted — `max` is the bound.
- **`max` evicts least-recently-used.** Insertion-ordered `Map`; the first key out is the eviction victim.
- **Misses are `null`, and `has()` disambiguates.** A stored `null` reads as `null` too — `has()` tells it apart from a miss.
- **Per-entry TTL** overrides the constructor default: `set(key, value, { ttl: 5_000 })`.
- **Config fails fast.** Non-positive `max` or `ttl` throws `E_BAD_CACHE_OPTIONS` at construction (and on `set` opts); nothing throws on the traffic path.

## Surface

```ts
declare class Cache<V> {
  constructor(opts?: { max?: number; ttl?: number }, now?: () => number);
  get(key: string): V | null;
  set(key: string, value: V, opts?: { ttl?: number }): this;
  has(key: string): boolean;
  peek(key: string): V | null;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}
```

`max` defaults to `Infinity` (unbounded); `ttl` defaults to no expiry. `now` is a constructor-only test seam for a fake clock — not part of the stable surface.

## Divergences from lru-cache

Deliberate, documented — every one is a subset constraint or a YAGNI call:

| lru-cache                                                   | @chttp/cache                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `V \| undefined` misses                                     | `V \| null` misses; `has()` disambiguates                                            |
| `new LRUCache<K, V>()` (typed keys + values)                | `Cache<V>` phantom-generic alias — keys are `string`, values narrow at the call site |
| `ttlAutopurge`, internal timers                             | lazy purge on access only; `max` bounds memory                                       |
| `dispose`/`fetch`/`sizeCalculation`, stale-while-revalidate | not shipped — follow-up tickets on demand                                            |
| `mget`/`mset`                                               | loop `get`/`set`                                                                     |
| `ttl: 0` = no expiry                                        | `ttl <= 0` throws `E_BAD_CACHE_OPTIONS`                                              |

## Bigger than memory? Cache-aside, not a second module

A single-ELF app has exactly one memory domain — that covers rate-limit windows, session memoization, upstream-response memoization and job dedup. When it doesn't (multi-replica coherence, persistence), layer a store _under_ this cache instead of swapping the API:

```ts
// Store seam — implement this plain shape against your backend
// (Upstash REST over fetch, Redis over net.Socket, ...).
interface CacheStore {
  get(key: string): Promise<string | null>; // values JSON-encoded
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<void>;
}
```

```ts
const memory = new Cache({ max: 5_000, ttl: 30_000 });

async function getUser(store: CacheStore, id: string): Promise<string | null> {
  const hit = memory.get("user:" + id);
  if (hit !== null) {
    return hit;
  }
  const v = await store.get("user:" + id);
  if (v !== null) {
    memory.set("user:" + id, v);
  }
  return v;
}
```

Backend clients live as greppable examples (an Upstash REST store is the recommended default; a RESP-over-`net.Socket` Redis store ships only on demand) — the package itself stays zero-dependency.

## Tests

`pnpm --filter @chttp/cache test` builds with tsc, runs the `node --test` suite (LRU order, TTL via the injected clock, value round-trips, a real `@chttp/router` handler chain over HTTP) and the ELF smoke (`test/elf.test.sh`: `scriptc build` + native run). `scripts/scriptc-gate.sh` keeps `gate.ts` at 100% static coverage.

## License

Apache-2.0
