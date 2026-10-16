// Value round-trip tests for @cutils/cache — runs on the tsc build
// (node --test). The memory cache stores live references (no JSON
// encode/decode); the null-vs-miss contract is exercised via has().
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../dist/esm/index.js";

test("object values round-trip by live reference", () => {
  const c = new Cache();
  const obj = { a: 1, nested: { b: [1, 2, 3] } };
  c.set("k", obj);
  const back = c.get("k");
  assert.equal(back, obj); // identity, not a copy
  back.a = 99;
  assert.equal(c.get("k").a, 99); // mutations are visible
});

test("stored null vs miss: get returns null both ways, has disambiguates", () => {
  const c = new Cache();
  c.set("nullish", null);
  assert.equal(c.get("nullish"), null); // stored null reads as null
  assert.equal(c.has("nullish"), true); // ...but the entry exists
  assert.equal(c.get("missing"), null);
  assert.equal(c.has("missing"), false);
});

test("all primitive value kinds round-trip", () => {
  const c = new Cache();
  c.set("s", "str");
  c.set("n", 42.5);
  c.set("b", true);
  c.set("z", 0);
  c.set("big", 9007199254740993n);
  c.set("arr", [1, "two", null]);
  assert.equal(c.get("s"), "str");
  assert.equal(c.get("n"), 42.5);
  assert.equal(c.get("b"), true);
  assert.equal(c.get("z"), 0);
  assert.equal(c.get("big"), 9007199254740993n);
  assert.deepEqual(c.get("arr"), [1, "two", null]);
});

test("overwrite replaces the value; set returns the cache for chaining", () => {
  const c = new Cache();
  assert.equal(c.set("k", 1), c);
  c.set("k", 2).set("k2", 3); // chained
  assert.equal(c.get("k"), 2);
  assert.equal(c.get("k2"), 3);
});

test("delete removes an entry; clear empties the cache", () => {
  const c = new Cache();
  c.set("a", 1);
  c.set("b", 2);
  c.delete("a");
  assert.equal(c.has("a"), false);
  assert.equal(c.get("b"), 2);
  c.delete("missing"); // no-op
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.has("b"), false);
});

test("size tracks live entries", () => {
  const c = new Cache({ max: 3 });
  assert.equal(c.size, 0);
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.size, 2);
  c.set("a", 9); // overwrite does not grow
  assert.equal(c.size, 2);
});

test("constructor throws E_BAD_CACHE_OPTIONS on non-positive max/ttl", () => {
  assert.throws(() => new Cache({ max: 0 }), /E_BAD_CACHE_OPTIONS/);
  assert.throws(() => new Cache({ max: -1 }), /E_BAD_CACHE_OPTIONS/);
  assert.throws(() => new Cache({ max: NaN }), /E_BAD_CACHE_OPTIONS/);
  assert.throws(() => new Cache({ ttl: 0 }), /E_BAD_CACHE_OPTIONS/);
  assert.throws(() => new Cache({ ttl: -5 }), /E_BAD_CACHE_OPTIONS/);
  // positive values are fine
  assert.doesNotThrow(() => new Cache({ max: 1, ttl: 1 }));
  assert.doesNotThrow(() => new Cache({ max: Infinity }));
});

test("set throws E_BAD_CACHE_OPTIONS on non-positive per-entry ttl", () => {
  const c = new Cache();
  assert.throws(() => c.set("k", 1, { ttl: 0 }), /E_BAD_CACHE_OPTIONS/);
  assert.throws(() => c.set("k", 1, { ttl: -1 }), /E_BAD_CACHE_OPTIONS/);
});
