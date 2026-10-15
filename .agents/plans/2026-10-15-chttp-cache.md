# @chttp/cache — LRU+TTL memory cache for scriptc, 2026-10-15

## What this is

One class: a memory `Cache` with lru-cache-parity semantics (LRU
eviction + per-entry TTL), sized for chttp apps, compiling to a static
ELF. Distributed backends (Redis via RESP, Upstash REST) are EXAMPLES
implementing a documented 5-method store shape — not package code.
LMDB/FFI is demoted off the roadmap (ABI v21 broke every shim and each
scriptc release re-breaks them; recurring tax with no current demand).

`@chttp/*` not `@cutils/*`: a request-scoped cache is a web-server
concern (per-worker memory, request co-location), which is the family
split.

## Why

- **The 90% cache is in-process.** Single-ELF apps have exactly one
  memory domain; an LRU+TTL map covers rate-limit windows, session
  lookup memoization, upstream-response memoization, and job dedup for
  most deployments. Zero network, zero protocol code.
- **lru-cache parity on the parts that matter.** `get` bumps recency,
  `peek` doesn't, `has` purges expired, per-entry `ttl` overrides the
  constructor default, `max` evicts least-recently-used. Anyone who has
  used lru-cache (the reference API, 60M+ weekly) already knows this
  surface; we implement its stable core and nothing else.
- **Map is legal now.** The 0.3.3 probe lifted the Map/Set ban
  (`memory:scriptc_ground_truth.md`), so the classic Map-based LRU
  (delete-and-reinsert on get, evict-first-key on overflow) is
  available — O(1) without hand-rolled doubly-linked lists over record
  references (which subset-hostilely need function-typed fields).
- **Distributed is an example, not a module.** Redis/Upstash clients
  are one `fetch`/`net.Socket` wrapper away; inlining them couples the
  package to vendor APIs and doubles the test surface for the 10% case.
  Examples stay greppable and vendor-proof.

## Public surface

```ts
import { Cache } from "@chttp/cache";

type CacheOptions = {
  max?: number;       // default Infinity; LRU evicts past this
  ttl?: number;       // default: no expiry; ms; per-entry override below
};

// Methods are class methods (legal; the ban is object-literal method
// shorthand). Semantics follow lru-cache's stable core.
declare class Cache<V> {
  constructor(opts?: CacheOptions);
  get(key: string): V | null;                       // hit bumps recency; expired purges => null
  set(key: string, value: V, opts?: { ttl?: number }): this;
  has(key: string): boolean;                        // purges expired, does NOT bump recency
  peek(key: string): V | null;                      // no recency bump, expired purges
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

// Typing note: get/peek return `V | null` (family convention), not
// `V | undefined` (SC3004). lru-cache uses undefined; that is the one
// deliberate divergence — a stored value may itself be null-ish only
// if V allows it, and `has()` distinguishes miss from stored-null.
```

### Store seam (documented shape, for examples — not exported code)

Examples implement this plain shape to swap the backend; the README
shows a `get`-through-wrapper that layers it under the memory `Cache`
(cache-aside):

```ts
type CacheStore = {
  get(key: string): Promise<string | null>;   // values JSON-encoded
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<void>;  // optional; SCAN for redis
};
```

### Why this shape

1. **One class, no factory, no stores array.** cache-manager's
   multi-store wrapping is the top-library pattern for MULTI-backend
   apps; a single-ELF app has one memory backend, so the wrapper is
   dead weight. Cache-aside composition (memory Cache in front of a
   store from examples) is shown in the README instead.
2. **`null` misses, `has()` disambiguates.** Matches the `*Raw`/DB
   family (`getOrNull` precedent) and dodges SC3004.
3. **Lazy TTL only.** No timers, no `ttlAutopurge`: expired entries
   purge on access. A cache that never gets read again leaks entries —
   bounded by `max`, which is the actual memory contract. Documented.
4. **No `sizeCalculation`, no `fetch` dedup, no stale-while-revalidate,
   no `dispose` callbacks.** Each is a real lru-cache feature and each
   is a YAGNI until a user asks; `fetch`-dedup especially (promise
   bookkeeping in the subset) is a follow-up ticket, not v1.

### What we DON'T ship (and why)

| Dropped | Reason |
| --- | --- |
| Redis/Upstash client code in-package | examples instead; vendor coupling + double test surface |
| LMDB / FFI tier | DEMOTED: ABI v21 broke shims; every scriptc bump re-breaks; no demand |
| cache-manager multi-store wrapper | one backend per ELF process; compose cache-aside in user code |
| `wrap()` async fetch-dedup (stampede guard) | promise bookkeeping; follow-up ticket if asked |
| stale-while-revalidate, refreshBackground | same |
| `dispose`/`fetch`/`sizeCalculation` hooks | lru-cache's advanced surface; YAGNI |
| Timers / ttlAutopurge | lazy purge on access; `max` bounds memory |
| JSON-only values | memory cache stores live references; JSON-encode at the STORE seam (examples), not in memory |
| `mget`/`mset` | meaningless in-memory (loop it); belongs to the redis example |

## Implementation notes

- ~120-160 LoC: the Map-based LRU. `get`: expired-or-miss purge, then
  `delete(key)` + `set`-back (reinsertion = MRU). `set`: overwrite
  existing (Map preserves position on overwrite — must delete+set),
  then evict `first key` while `size > max`. `has`/`peek`: read expiry,
  purge if stale.
- Map iteration order = insertion order (probe-verified behavior via
  `for...of` over `entries()`); first-key via one `for...of` + immediate
  `break` — no iterator `.next()` games.
- Timestamps via `Date.now()`; no `performance.now` (monotonic would be
  nicer; not worth the surface — TTLs here are seconds-scale).
- No `Object.freeze`, no getters beyond `size`, no computed keys.
- Errors: none thrown in the happy path; `max <= 0` or non-positive
  `ttl` in constructor throws `E_BAD_CACHE_OPTIONS` (fail fast on
  config, never on traffic).

## Testing strategy

1. **LRU eviction order** (`test/lru.test.ts`): fill past `max`,
   assert eviction order; `get` bumps recency (access pattern decides
   survivor); `peek`/`has` do NOT.
2. **TTL** (`test/ttl.test.ts`): default + per-entry override, expiry
   on get/has/peek, overwrite resets entry TTL, fake-clock via injected
   `now` (constructor opt `now?: () => number` for tests only — one
   test seam, documented, not part of the stable surface).
3. **Round-trip with real values** (`test/values.test.ts`): objects,
   null-valued entry vs miss (via `has`), overwrite, clear, size.
4. **Concurrent-ish semantics** (`test/dispatch.test.ts`): use inside a
   real `@chttp/router` handler chain — set in one request, get in the
   next (memory persists across requests in-process).
5. **Subset gate + ELF smoke** (`test/coverage.test.mjs`,
   `test/elf.test.sh`): coverage 100% AND the ELF runs the eviction +
   TTL assertions (0.3.3 defers fences to runtime — build+run is the
   real gate; `memory:scriptc_ground_truth.md`).

Baseline per rule 9c: `/tmp/chttp-cache-baseline-<ts>.log` before
iterating; diff before done.

## File layout

```
packages/cache/
├── AGENTS.md              # subset notes + lru-cache divergence list
├── README.md              # usage + cache-aside-with-redis example pointer
├── CHANGELOG.md
├── package.json           # name: @chttp/cache; zero deps
├── tsconfig.json
├── src/
│   ├── index.ts           # Cache re-export
│   └── cache.ts           # the LRU+TTL Map-based class
└── test/
    ├── lru.test.ts
    ├── ttl.test.ts
    ├── values.test.ts
    ├── dispatch.test.ts
    ├── coverage.test.mjs
    └── elf.test.sh
```

## Dependencies

- Zero. Runtime, peer, everything. The store seam is documentation;
  examples carry their own deps.

## Examples (separate from the package)

- `examples/cache-upstash/` — REST store (INCR-style endpoints over
  `fetch`), ~80 LoC, implements `CacheStore`, cache-aside README recipe.
  The recommended default when memory won't cut it: zero protocol code,
  works in every runtime.
- `examples/cache-redis/` — RESP2 over `net.Socket` (~250-350 LoC,
  PerryTS-style writer/reader), for self-hosted Redis. Only if/when
  someone actually needs non-Upstash Redis; otherwise it rots.
  Demand-gated: build on request, not speculatively.

## Scope discipline

- **Do not** add backend clients to the package. The store seam lives in
  docs; backends live in `examples/`.
- **Do not** grow past the 8-method lru-cache core without a demand
  case. Each lru-cache feature is a follow-up ticket.
- **Do not** add timers. Lazy purge is the contract.
- **Do not** return `undefined` from `get`/`peek` (SC3004); `null` is
  the miss sentinel and `has()` is the disambiguator — keep the
  divergence table in the README current.

## Bench cell (required before any perf claim)

`bench/cells/cache-elf.yml` — vs lru-cache under Node 24: mixed
get/set workload, 10k keys, eviction-heavy and TTL-heavy modes. v1
ships without perf claims (family policy).

## Risk register

- **`null`-vs-`undefined` divergence trips lru-cache migrants.**
  Mitigation: README divergence table up top; `has()` shown in the
  first example.
- **Lazy purge surprises** (unread expired entries hold memory).
  Mitigation: documented; `max` is the bound; a `purgeExpired()` method
  is a trivial follow-up if ever needed.
- **Map iteration-order dependence** (eviction via first-key) — this is
  spec behavior in JS (`Map` is insertion-ordered), probe-verified in
  the ELF. Re-asserted by `test/lru.test.ts` on every run.
- **Scriptc regression.** `scriptc coverage` 100% + ELF run gate in CI.

## Cross-cutting (ripples)

- **`@chttp/auth`** — `MemorySessionStore` and this share the
  lazy-purge-map pattern; auth ships its own tiny store (dev-only,
  different contract: no `max`, sliding expiry). Not unified — YAGNI on
  a shared "storage" abstraction.
- **`@chttp/ratelimit` (candidate)** — would consume this Cache as its
  window store. If the rate-limit ticket ever opens, it depends on this
  package, not the reverse.
- **Examples** — `cache-upstash` recommended; `cache-redis`
  demand-gated.
- **CHANGELOG/CI** — fixed-version group; no release workflow change.

## Task breakdown

### T0 — Plan, ticket, wiring (S, infra)
- [ ] GitHub issue "Ship @chttp/cache v0.1.0" (refined fields).

### T1 — Cache class (S, feature)
- [ ] `cache.ts` + LRU/TTL/values tests (injected `now` test seam).

### T2 — Router integration test (S, feature)
- [ ] `dispatch.test.ts`: cross-request memory persistence.

### T3 — Gates + docs (S, infra)
- [ ] `coverage.test.mjs` (100% + ELF run), `elf.test.sh`, README
      (divergence table, cache-aside recipe), AGENTS.md,
      `pnpm change` intent.

### T4 — Follow-ups (separate tickets)
- [ ] Bench cell `bench/cells/cache-elf.yml`.
- [ ] `examples/cache-upstash/`.
- [ ] `examples/cache-redis/` (RESP over net.Socket) — demand-gated.
- [ ] `purgeExpired()`, `wrap()` fetch-dedup, `mget` — demand-gated.

## References

- lru-cache (API reference): `https://github.com/isaacs/node-lru-cache`.
- Map insertion-order (spec): ECMA-262 §24.2 (Map Objects).
- Probe evidence: `memory:scriptc_ground_truth.md` (Map/Set 100% on
  0.3.3, ELF run).
- Vendor verdicts (LMDB demotion context): `memory:vendor_candidates.md`.
