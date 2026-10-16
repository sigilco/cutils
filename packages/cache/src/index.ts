// @cutils/cache — public surface.
//
// The runtime class is the non-generic CacheCore: generic CLASS
// parameters degrade instances to methodless shells under scriptc
// 0.3.x, so `Cache<V>` is a type-level alias over CacheCore — the same
// pattern @chttp/router uses for Ctx<P>/ReqView<P>. `V` is a phantom
// parameter documenting intended value type; get/peek still return
// `unknown | null` (see the README divergence table). A narrowed
// `get(key): V | null` interface member would itself refuse to lower,
// so the typed surface cannot be carried on the class.

import { CacheCore } from "./cache.ts";
import type { CacheEntry, CacheOptions, CacheSetOptions } from "./cache.ts";

export { CacheCore };
export type { CacheEntry, CacheOptions, CacheSetOptions };

export interface Cache<_V> extends CacheCore {}
export const Cache = CacheCore;
