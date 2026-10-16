// TTL tests for @cutils/cache — runs on the tsc build (node --test).
// The constructor-only `now` seam injects a fake clock so expiry is
// deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../dist/esm/index.js";

function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t = t + ms;
    },
  };
}

test("default ttl expires entries on get", () => {
  const c = clock();
  const cache = new Cache({ ttl: 100 }, c.now);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  c.advance(99);
  assert.equal(cache.get("a"), 1);
  c.advance(1);
  assert.equal(cache.get("a"), null);
  assert.equal(cache.size, 0); // expired entry purged, not just hidden
});

test("per-entry ttl overrides the constructor default", () => {
  const c = clock();
  const cache = new Cache({ ttl: 100 }, c.now);
  cache.set("short", 1, { ttl: 10 });
  cache.set("long", 2);
  c.advance(50);
  assert.equal(cache.get("short"), null);
  assert.equal(cache.get("long"), 2);
});

test("per-entry ttl can outlive the constructor default", () => {
  const c = clock();
  const cache = new Cache({ ttl: 10 }, c.now);
  cache.set("a", 1, { ttl: 1000 });
  c.advance(500);
  assert.equal(cache.get("a"), 1);
});

test("expiry applies to has and peek too", () => {
  const c = clock();
  const cache = new Cache({ ttl: 100 }, c.now);
  cache.set("a", 1);
  c.advance(200);
  assert.equal(cache.has("a"), false);
  cache.set("b", 2);
  c.advance(200);
  assert.equal(cache.peek("b"), null);
  assert.equal(cache.size, 0);
});

test("overwrite resets the entry ttl", () => {
  const c = clock();
  const cache = new Cache({ ttl: 100 }, c.now);
  cache.set("a", 1);
  c.advance(90);
  cache.set("a", 2); // fresh 100ms window
  c.advance(90);
  assert.equal(cache.get("a"), 2);
  c.advance(11);
  assert.equal(cache.get("a"), null);
});

test("no ttl means entries never expire", () => {
  const c = clock();
  const cache = new Cache({}, c.now);
  cache.set("a", 1);
  c.advance(1e9);
  assert.equal(cache.get("a"), 1);
});

test("expired entries are invisible to eviction accounting", () => {
  const c = clock();
  const cache = new Cache({ max: 2, ttl: 100 }, c.now);
  cache.set("a", 1);
  cache.set("b", 2);
  c.advance(200); // both stale, still physically in the map
  cache.set("c", 3); // evicts "a" (first key) even though it was expired
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), null);
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("c"), 3);
});
