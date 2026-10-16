// LRU eviction tests for @cutils/cache — runs on the tsc build (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../dist/esm/index.js";

test("fill past max evicts least-recently-used first", () => {
  const c = new Cache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3); // evicts "a"
  assert.equal(c.get("a"), null);
  assert.equal(c.get("b"), 2);
  assert.equal(c.get("c"), 3);
  assert.equal(c.size, 2);
});

test("get bumps recency; the untouched key evicts", () => {
  const c = new Cache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.get("a"), 1); // a is now MRU
  c.set("c", 3); // evicts "b"
  assert.equal(c.get("b"), null);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("c"), 3);
});

test("peek does NOT bump recency", () => {
  const c = new Cache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.peek("a"), 1); // peek: a stays LRU
  c.set("c", 3); // evicts "a", not "b"
  assert.equal(c.get("a"), null);
  assert.equal(c.get("b"), 2);
});

test("has does NOT bump recency", () => {
  const c = new Cache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.has("a"), true); // has: a stays LRU
  c.set("c", 3); // evicts "a"
  assert.equal(c.get("a"), null);
  assert.equal(c.get("b"), 2);
});

test("re-set of an existing key moves it to MRU", () => {
  const c = new Cache({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.set("a", 10); // overwrite: a is now MRU
  c.set("c", 3); // evicts "b"
  assert.equal(c.get("b"), null);
  assert.equal(c.get("a"), 10);
});

test("default max is unbounded", () => {
  const c = new Cache();
  for (let i = 0; i < 1000; i++) {
    c.set("k" + i, i);
  }
  assert.equal(c.size, 1000);
  assert.equal(c.get("k0"), 0);
  assert.equal(c.get("k999"), 999);
});
