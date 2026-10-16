// scriptc coverage gate — exercises the full @cutils/cache public surface.
// scripts/scriptc-gate.sh requires `compile statically (100%)` here.

import { Cache, CacheCore } from "./src/index.ts";
import type { CacheOptions, CacheSetOptions } from "./src/index.ts";

// Every method on the aliased constructor (lowers to CacheCore).
const c: Cache<string> = new Cache({ max: 3, ttl: 1000 });
c.set("a", "1");
c.set("b", "2", { ttl: 5 });
const hit: unknown | null = c.get("a");
const peeked: unknown | null = c.peek("b");
const present: boolean = c.has("a");
c.delete("a");
c.clear();
const n: number = c.size;

// Constructor seams: CacheOptions/CacheSetOptions records, injected clock.
const opts: CacheOptions = { max: 4, ttl: 50 };
const setOpts: CacheSetOptions = { ttl: 9 };
let tick = 0;
const c2: Cache<number> = new Cache(opts, () => {
  tick = tick + 1;
  return tick;
});
c2.set("x", 1, setOpts);

// Non-generic core class is public too.
const core = new CacheCore();
core.set("k", "v");

// Config failure path.
let code = "";
try {
  const bad = new Cache({ max: 0 });
  bad.set("x", "y");
} catch (e) {
  code = String(e);
}

if (hit === null || peeked === null || !present || n !== 0 || code === "") {
  throw new Error("gate: unreachable");
}
