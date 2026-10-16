// Cross-request persistence test: @cutils/cache inside a real @chttp/router
// handler chain over a live HTTP server. The cache is process memory — a
// value set in one request must be visible to the next.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "@chttp/router";
import { Cache } from "../dist/esm/index.js";

const cache = new Cache({ max: 100, ttl: 60_000 });
const app = createRouter();

app.put(
  "/cache/:k",
  (c) => {
    cache.set(c.req.param("k"), c.req.body());
    return c.status(201).text("set");
  },
  { body: true },
);

app.get("/cache/:k", (c) => {
  const v = cache.get(c.req.param("k"));
  if (v === null) {
    return c.status(404).text("miss");
  }
  return c.text(v);
});

const server = http.createServer(app.handler());
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

after(() => server.close());

test("a value set in one request is served to the next", async () => {
  const put = await fetch(`${base}/cache/session-1`, {
    method: "PUT",
    body: "tok-abc",
  });
  assert.equal(put.status, 201);

  const get = await fetch(`${base}/cache/session-1`);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), "tok-abc");
});

test("a missing key answers 404 via the null-miss contract", async () => {
  const res = await fetch(`${base}/cache/never-set`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "miss");
});

test("middleware can memoize upstream work across requests", async () => {
  let calls = 0;
  const memoApp = createRouter();
  const memo = new Cache();
  memoApp.use((c, _next) => {
    const hit = memo.get("price:btc");
    if (hit !== null) {
      return c.text(hit);
    }
    calls = calls + 1;
    const computed = "69000." + calls;
    memo.set("price:btc", computed);
    return c.text(computed);
  });
  memoApp.get("/price", (c) => c.text("unreachable"));
  const memoServer = http.createServer(memoApp.handler());
  await new Promise((resolve) => memoServer.listen(0, "127.0.0.1", resolve));
  const memoBase = `http://127.0.0.1:${memoServer.address().port}`;
  try {
    const first = await fetch(`${memoBase}/price`);
    const second = await fetch(`${memoBase}/price`);
    assert.equal(await first.text(), "69000.1");
    assert.equal(await second.text(), "69000.1"); // cached, not recomputed
    assert.equal(calls, 1);
  } finally {
    memoServer.close();
  }
});
