# @cutils/cache

LRU + TTL in-process memory cache with [lru-cache](https://github.com/isaacs/node-lru-cache)-parity semantics, authored in the scriptc-compilable subset — the same source runs under Node and lowers into a native ELF.

## Quickstart

::: tabs

== tab Node

```sh
pnpm add @cutils/cache
```

```ts
import { Cache } from "@cutils/cache";

const sessions: Cache<string> = new Cache({ max: 10_000, ttl: 60_000 });

sessions.set("sess-1", "uid:42");
sessions.get("sess-1"); // "uid:42" — bumps recency
sessions.get("missing"); // null — misses are never undefined
```

== tab Native ELF

```ts
import { Cache } from "@cutils/cache";

const seen: Cache<number> = new Cache({ max: 1_000 });
seen.set("job-7", 1);
```

```sh
scriptc build src/main.ts -o app
```

:::

## Semantics

- `get` bumps recency; `peek` and `has` don't. Recency picks the eviction victim when `size > max`.
- `max` evicts least-recently-used first (insertion-ordered `Map`); `ttl` expires lazily on access — no timers.
- Misses return `null`; `has()` distinguishes a stored `null` from a miss.
- `set(key, value, { ttl })` overrides the constructor TTL per entry.
- Non-positive `max`/`ttl` throws `E_BAD_CACHE_OPTIONS` at construction — config fails fast, traffic never does.

## Divergences from lru-cache

| lru-cache | @cutils/cache |
| --- | --- |
| `V \| undefined` misses | `V \| null`; `has()` disambiguates |
| `LRUCache<K, V>` typed keys + values | `Cache<V>` phantom alias; keys are `string`, values narrow at the call site |
| `ttlAutopurge` / timers | lazy purge on access; `max` bounds memory |
| `dispose`, `fetch`, `sizeCalculation`, stale reads | not shipped — demand-gated follow-ups |
| `mget`/`mset` | loop `get`/`set` |
| `ttl: 0` = no expiry | `ttl <= 0` throws `E_BAD_CACHE_OPTIONS` |

## Bigger than memory

When one process isn't enough (multi-replica coherence, persistence), layer a remote store under the memory cache — cache-aside, not a different API. Implement the documented `CacheStore` shape (in the [package README](https://github.com/sigilco/cutils/tree/main/packages/cache#readme)) against your backend; the README carries the full recipe and a `getUser` walkthrough.
