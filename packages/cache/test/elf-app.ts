// ELF smoke app for @chttp/cache — compiled with `scriptc build` by
// test/elf.test.sh. Fills past max, asserts eviction order and TTL
// expiry inside the native binary, prints OK.

import { Cache } from "../src/index.ts";

function assert(cond: boolean, what: string): void {
  if (!cond) {
    throw new Error("elf-cache FAIL: " + what);
  }
}

// --- LRU eviction order ---
const c = new Cache({ max: 2 });
c.set("a", "1");
c.set("b", "2");
c.set("c", "3"); // evicts "a"
assert(c.get("a") === null, "a should be evicted");
assert(c.get("b") === "2", "b should survive");
assert(c.get("c") === "3", "c should be present");
assert(c.size === 2, "size should be 2");

// get bumps recency
const d = new Cache({ max: 2 });
d.set("x", "1");
d.set("y", "2");
d.get("x"); // x -> MRU
d.set("z", "3"); // evicts "y"
assert(d.get("y") === null, "y should be evicted after x was read");
assert(d.get("x") === "1", "x should survive after get bump");

// peek does not bump
const p = new Cache({ max: 2 });
p.set("x", "1");
p.set("y", "2");
p.peek("x"); // no bump: x stays LRU
p.set("z", "3"); // evicts "x"
assert(p.get("x") === null, "x should be evicted (peek does not bump)");
assert(p.get("y") === "2", "y should survive");

// --- TTL expiry via injected clock ---
let t = 1000;
const ttl = new Cache({ ttl: 100 }, () => t);
ttl.set("k", "v");
assert(ttl.get("k") === "v", "fresh entry should hit");
t = 1099;
assert(ttl.get("k") === "v", "entry within ttl should hit");
t = 1100;
assert(ttl.get("k") === null, "expired entry should miss");
assert(ttl.size === 0, "expired entry should purge on read");

// per-entry ttl override
t = 2000;
const ttl2 = new Cache({ ttl: 10 }, () => t);
ttl2.set("s", "1", { ttl: 5 });
ttl2.set("l", "2");
t = 2007;
assert(ttl2.get("s") === null, "short per-entry ttl should expire");
assert(ttl2.get("l") === "2", "longer entry should survive");

// has() disambiguates stored-null vs miss
const n = new Cache({});
n.set("nullish", null);
assert(n.get("nullish") === null, "stored null reads as null");
assert(n.has("nullish") === true, "has() sees stored null");
assert(n.has("missing") === false, "has() misses absent key");

// config fail-fast
let threw = false;
try {
  const bad = new Cache({ max: 0 });
  bad.set("x", "y");
} catch (e) {
  threw = String(e).indexOf("E_BAD_CACHE_OPTIONS") >= 0;
}
assert(threw, "max:0 should throw E_BAD_CACHE_OPTIONS");

console.log("OK");
