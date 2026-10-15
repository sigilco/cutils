// CacheCore — Map-based LRU+TTL memory cache authored inside the
// scriptc-compilable subset (Map lifted by the 0.3.3 probe; see AGENTS.md).
//
// Semantics follow lru-cache's stable core:
//   - get bumps recency (delete + reinsert); peek/has do not.
//   - has/peek still purge an expired entry (lazy TTL only — no timers).
//   - set on an existing key re-inserts at MRU position (Map preserves
//     position on overwrite, so an explicit delete is required first).
//   - Past `max`, the least-recently-used entry (the Map's first key,
//     insertion-ordered) evicts until size <= max.
//   - Misses return null (never undefined — SC3004); has() disambiguates
//     a stored null-ish value from a miss.
//
// Subset notes: `| null` unions only; class fields concretely typed (values
// live in a plain CacheEntry record, where `unknown` members are legal);
// eviction reads the first key via one `for...of` over `entries()` +
// immediate break — no iterator `.next()` games. Timestamps are Date.now()
// (TTLs are seconds-scale; a monotonic clock is not worth the surface).

export interface CacheOptions {
  max?: number; // default Infinity; LRU evicts past this
  ttl?: number; // default: no expiry; ms; per-entry override on set()
}

export interface CacheSetOptions {
  ttl?: number; // per-entry TTL in ms; overrides the constructor default
}

// Internal record shape for stored values. `value` is `unknown`, which is
// legal inside a plain record (only class fields must be concrete). The
// public type-level `Cache<V>` alias in index.ts narrows it per consumer.
export interface CacheEntry {
  value: unknown;
  expiresAt: number; // epoch ms; Infinity = never expires
}

export class CacheCore {
  _store: Map<string, CacheEntry>;
  _max: number;
  _ttl: number;
  _now: () => number;

  // `now` is a constructor-only test seam (fake clock), deliberately NOT a
  // CacheOptions record member — function values inside records degrade
  // instantiation under scriptc.
  constructor(opts?: CacheOptions, now?: () => number) {
    const o: CacheOptions = opts === undefined || opts === null ? {} : opts;
    const max: number = o.max === undefined ? Infinity : o.max;
    const ttl: number = o.ttl === undefined ? Infinity : o.ttl;
    if (!(max > 0)) {
      throw new Error("E_BAD_CACHE_OPTIONS: max must be a positive number");
    }
    if (!(ttl > 0)) {
      throw new Error("E_BAD_CACHE_OPTIONS: ttl must be a positive number");
    }
    this._store = new Map<string, CacheEntry>();
    this._max = max;
    this._ttl = ttl;
    this._now = now === undefined ? Date.now : now;
  }

  _expired(entry: CacheEntry, now: number): boolean {
    return entry.expiresAt !== Infinity && now >= entry.expiresAt;
  }

  _evict(): void {
    while (this._store.size > this._max) {
      let oldest: string | null = null;
      for (const e of this._store.entries()) {
        oldest = e[0];
        break;
      }
      if (oldest === null) {
        break;
      }
      this._store.delete(oldest);
    }
  }

  get(key: string): unknown | null {
    const entry = this._store.get(key);
    if (entry === undefined) {
      return null;
    }
    if (this._expired(entry, this._now())) {
      this._store.delete(key);
      return null;
    }
    // Recency bump: delete + reinsert moves the entry to MRU position.
    this._store.delete(key);
    this._store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, opts?: CacheSetOptions): CacheCore {
    let ttl = this._ttl;
    if (opts !== undefined && opts !== null && opts.ttl !== undefined) {
      ttl = opts.ttl;
      if (!(ttl > 0)) {
        throw new Error("E_BAD_CACHE_OPTIONS: ttl must be a positive number");
      }
    }
    // Map preserves insertion position on overwrite — delete first so a
    // re-set key lands at MRU, matching lru-cache.
    this._store.delete(key);
    const entry: CacheEntry = {
      value: value,
      expiresAt: ttl === Infinity ? Infinity : this._now() + ttl,
    };
    this._store.set(key, entry);
    this._evict();
    return this;
  }

  has(key: string): boolean {
    const entry = this._store.get(key);
    if (entry === undefined) {
      return false;
    }
    if (this._expired(entry, this._now())) {
      this._store.delete(key);
      return false;
    }
    return true;
  }

  peek(key: string): unknown | null {
    const entry = this._store.get(key);
    if (entry === undefined) {
      return null;
    }
    if (this._expired(entry, this._now())) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key: string): void {
    this._store.delete(key);
  }

  clear(): void {
    this._store.clear();
  }

  get size(): number {
    return this._store.size;
  }
}
