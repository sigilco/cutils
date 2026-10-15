# @chttp/cache

## 0.1.0

### Minor Changes

- Initial release: Map-based LRU+TTL memory cache with lru-cache parity semantics — `get` bumps recency, `peek`/`has` do not, lazy TTL purge on access, LRU eviction past `max`. `Cache<V>` is a phantom-generic alias over `CacheCore` for scriptc compatibility; misses return `null`, `has()` disambiguates stored nulls.
