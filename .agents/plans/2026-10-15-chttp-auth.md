# @chttp/auth — session, password, JWT, OAuth2+PKCE, CSRF, TOTP primitives for scriptc, 2026-10-15

## What this is

The "20% that matters" auth package: the crypto and protocol primitives every
chttp app needs, as plain async functions over `node:crypto`, composable with
`@chttp/router` handlers (both the node:http `Ctx` and the Web Standards
`app.fetch` surface from PR #56 — every function is string-in/string-out or
boolean-out, none of them touch `c`). Sessions (Lucia pattern), scrypt password
hashing, HS256/ES256 JWT, OAuth2 authorization-code + PKCE, and double-submit
CSRF. That is the whole list: the top-used patterns only, KISS/YAGNI.

**The vendor premise died.** The original scoping vendored
`@oslojs/encoding` + `@oslojs/crypto` (5KB) as the crypto foundation.
scriptc 0.3.3 ships the **full** `node:crypto` surface statically —
`timingSafeEqual`, `scryptSync`, `randomBytes`, `createHmac`, `createSign`
with `dsaEncoding: "ieee-p1363"`, base64url via `Buffer` — verified in
`memory:scriptc_ground_truth.md`. oslo's remaining value is base32 (needed
only for TOTP): a 40-LoC RFC 4648 hand-roll replaces the whole vendor. Like
`@cutils/url`, this is a scope reduction driven by re-verified ground truth.

**Schema seam is Standard Schema, not @chttp/val.** The two typed-input
functions (`verifyJwtWith`, `fetchUserInfoWith`) accept any
`StandardSchemaV1` (type-only import from `@standard-schema/spec`).
@chttp/val, valibot (verified compiling under scriptc 0.3.3, upstream fix
pending), or zod-at-Node-time all plug in. Zero runtime deps.

## Why

- **Every app needs sessions; nobody should hand-roll them twice.** The
  Lucia-maintained pattern is ~150 LoC: random token, SHA-256 store key,
  constant-time compare, sliding expiry. It is the model to copy — zero
  framework machinery, three crypto primitives.
- **better-auth is 80% machinery, 20% protocol.** ~80k LoC total; the
  plugin/org/ORM-adapter surface is what scriptc can never lower. The
  protocol + crypto 20% (sessions, PKCE, JWT, password hashing) is fully
  inside the subset against `node:crypto`.
- **`node:crypto` is first-class in scriptc 0.3.3.** mbedTLS-backed,
  statically linked, already in every ELF — auth adds no binary surface
  beyond our own ~900 LoC.
- **jose is a 50× blow-up for our need.** HS256/ES256 sign+verify is <150
  LoC against `createHmac`/`createVerify`. No JWE, no JWKS machinery, no
  EdDSA/ML-DSA in v1.
- **Category gap.** No compiled-native auth primitive package exists.
  better-auth (Drizzle/Kysely adapters, Map/Set everywhere) is a confirmed
  subset miss; Lucia itself is deprecated-library-as-pattern.

## Non-goals

- **WebAuthn/passkeys.** CBOR parsing (~400-500 LoC) plus 8 attestation
  formats. Punt; revisit as a child-process bridge or never.
- **TOTP/2FA.** Cut for KISS: it drags in base32 (~100 LoC of RFC 4648
  machinery) for a pattern well behind sessions/OAuth/JWT in usage.
  Follow-up ticket with its own demand case.
- **Argon2.** Not in `node:crypto`. scrypt (memory-hard, OWASP-blessed) is
  the default; the format string self-describes parameters so a future
  Argon2 path can slot in.
- **Email sending / magic links.** The token primitives are trivial sugar
  over the session pattern; the hard part (SMTP/vendor outcall) is out of
  scope for the package. Follow-up ticket if asked for.
- **Refresh-token rotation machinery.** `exchangeCodeForTokens` returns the
  token set; storing and rotating it is app logic (documented pattern in
  README).
- **JWKS fetch/cache, JWE, EdDSA.** Follow-up tickets; `verifyJwt` covers
  symmetric and P-256 asymmetric today.
- **Plugin/provider machinery.** Providers are plain records; no registry,
  no hooks, no plugin buses. That is better-auth's un-lowerable 80%.
- **Orgs, teams, 2FA-enforcement policy, admin UI.** App logic.
- **Hono middleware reuse.** Probed on 0.3.3 (`memory:scriptc_ground_truth.md`):
  `hono/cors`/`hono/cookie` compile 100% but hono-as-a-handler fences at
  runtime (`this.router.match` SC1090, ~30 sites), generic
  `MiddlewareHandler<E>` never materializes (SC2001), and `hono/jwt` needs
  WebCrypto, which scriptc does not ship (global `crypto` typed `unknown`).
  Nothing here is reusable for auth's crypto path; hand-rolled stays correct.
- **Middleware that reads `c` directly.** Auth ships plain functions; a
  thin `withSession` example lives in `examples/`, not the package.

## Public surface

```ts
import {
  // sessions (Lucia pattern, sliding expiry)
  generateSessionToken, hashToken, createSession,
  validateSessionToken, invalidateSession, invalidateAllUserSessions,
  SessionStore, SessionRecord,
  MemorySessionStore,
  // cookies (Set-Cookie serialization + minimal read)
  serializeCookie, readCookie, buildSessionCookie,
  buildExpiredSessionCookie, buildCsrfCookie,
  // passwords (scrypt, self-describing format)
  hashPassword, verifyPassword,
  // CSRF (double-submit + origin check)
  generateCsrfToken, verifyCsrfToken, verifyRequestOrigin,
  // JWT (HS256 | ES256, null-on-invalid)
  signJwt, verifyJwt, verifyJwtWith,
  // OAuth2 authorization-code + PKCE (RFC 6749 + RFC 7636)
  generateState, generateCodeVerifier, codeChallenge,
  createAuthorizationURL, exchangeCodeForTokens,
  fetchUserInfo, fetchUserInfoWith, OAuthProvider, TokenSet,
  googleProvider, githubProvider,
} from "@chttp/auth";

// ---------- sessions

// Token = base64url(16-byte id) + "." + base64url(32-byte secret).
// 384 bits total entropy; never stored whole.
generateSessionToken(): string;

// SHA-256 hex of the full token. This is the store key and the only
// thing persisted. Exported so store adapters key consistently.
hashToken(token: string): string;

// The store contract. Implement with a class (methods OK; only object-
// literal method shorthand is subset-banned). Sync stores work: return
// values, not Promises — auth awaits them (one microtask, documented).
type SessionStore<A> = {
  get(key: string): SessionRecord<A> | null | Promise<SessionRecord<A> | null>;
  set(record: SessionRecord<A>): void | Promise<void>;
  updateExpiry(key: string, expiresAt: number): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  deleteAllForUser(userId: string): void | Promise<void>;
};

type SessionRecord<A> = {
  key: string;            // hashToken(token)
  userId: string;
  expiresAt: number;      // epoch ms
  attributes: A | null;   // app data (role, display name, ...)
};

createSession<A>(
  store: SessionStore<A>, token: string, userId: string,
  attributes: A | null, opts?: { ttlSeconds?: number },
): Promise<SessionRecord<A>>;

// Sliding expiry: valid session past the extension threshold gets
// expiresAt bumped and written back. Returns null for unknown,
// expired, or malformed tokens. Never throws.
validateSessionToken<A>(
  store: SessionStore<A>, token: string,
  opts?: { ttlSeconds?: number; extensionThresholdSeconds?: number },
): Promise<SessionRecord<A> | null>;

invalidateSession(store: SessionStore<any>, token: string): Promise<void>;
invalidateAllUserSessions(store: SessionStore<any>, userId: string): Promise<void>;

// Dev/test store. Record + lazy expiry sweep. NOT for production;
// README says so in bold.
class MemorySessionStore<A> implements SessionStore<A> { ... }

// ---------- cookies

serializeCookie(name: string, value: string, attrs: {
  maxAge?: number; path?: string; secure?: boolean;
  httpOnly?: boolean; sameSite?: "lax" | "strict" | "none";
}): string;   // full Set-Cookie header value

readCookie(cookieHeader: string | null, name: string): string | null;

// Prebuilt session cookie: HttpOnly, SameSite=Lax, Path=/,
// Secure=true (override for localhost), MaxAge = ttl.
buildSessionCookie(token: string, opts?: { secure?: boolean; ttlSeconds?: number }): string;
buildExpiredSessionCookie(opts?: { secure?: boolean }): string;  // logout
buildCsrfCookie(token: string, opts?: { secure?: boolean }): string; // NOT HttpOnly (double-submit needs JS read)

// ---------- passwords

// "scrypt:N:r:p:saltB64:hashB64" — verify self-describes parameters.
// Defaults per OWASP: N=2^17, r=8, p=1, 64-byte key.
hashPassword(password: string, opts?: { N?: number; r?: number; p?: number }): string;
verifyPassword(password: string, stored: string): boolean;  // timing-safe

// ---------- CSRF

generateCsrfToken(): string;  // base64url(32 bytes)
// Double-submit: constant-time compare of cookie vs submitted token.
verifyCsrfToken(cookieToken: string | null, submittedToken: string | null): boolean;
// Origin check for state-changing requests (the other CSRF half).
verifyRequestOrigin(originHeader: string | null, allowedOrigins: string[]): boolean;

// ---------- JWT (JWS compact serialization only)

signJwt(
  payload: { [k: string]: unknown },
  key: string | KeyObject,                    // string => HS256 secret;
  opts?: {                                    // KeyObject => ES256 P-256
    alg?: "HS256" | "ES256";                  // (inferred if omitted)
    expiresInSeconds?: number; issuer?: string; audience?: string;
  },
): string;   // adds iat/exp (numeric-date seconds), throws on missing key

// null on ANY failure: bad format, wrong alg, bad signature, expired,
// wrong issuer/audience. alg "none" always rejected. Never throws.
verifyJwt(
  token: string, key: string | KeyObject,
  opts?: { alg?: "HS256" | "ES256"; issuer?: string; audience?: string;
           clockToleranceSeconds?: number },
): { [k: string]: unknown } | null;

// val-first: same as verifyJwt, then parses claims through the schema.
// The schema is any StandardSchemaV1 (@chttp/val, valibot, ...). Returns
// the typed claims or null. Positional-schema convention
// (prepare(sql, schema)) applied to auth's one piece of untrusted input.
verifyJwtWith<Schema extends StandardSchemaV1>(
  token: string, key: string | KeyObject, schema: Schema,
  opts?: { alg?: "HS256" | "ES256"; issuer?: string; audience?: string;
           clockToleranceSeconds?: number },
): InferOutput<Schema> | null;

// ---------- OAuth2 + PKCE

type OAuthProvider = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string | null;  // GitHub: non-OIDC /user works
  scope: string[];                  // joined with spaces
  usePkce: boolean;
};

generateState(): string;          // base64url(32 bytes)
generateCodeVerifier(): string;   // base64url(32 bytes), RFC 7636 lengths
codeChallenge(verifier: string): string;  // S256: b64url(sha256(verifier)), no padding

createAuthorizationURL(
  provider: OAuthProvider, clientId: string, redirectURI: string,
  params: { state: string; codeVerifier: string | null; extraQuery?: { [k: string]: string } },
): string;  // WHATWG URL + searchParams

type TokenSet = {
  access_token: string;
  token_type: string;
  refresh_token: string | null;
  expires_in: number | null;
  scope: string | null;
  id_token: string | null;
  raw: { [k: string]: unknown };   // full provider response
};

// POST x-www-form-urlencoded (URLSearchParams body), basic auth for the
// client secret. Parses JSON AND form-urlencoded responses (RFC 6749
// permits both). Returns null on non-2xx or missing access_token;
// never throws, never surfaces provider error bodies as exceptions.
exchangeCodeForTokens(
  provider: OAuthProvider,
  params: { code: string; clientId: string; clientSecret: string | null;
            redirectURI: string; codeVerifier: string | null },
): Promise<TokenSet | null>;

fetchUserInfo(provider: OAuthProvider, accessToken: string): Promise<{ [k: string]: unknown } | null>;
fetchUserInfoWith<Schema extends StandardSchemaV1>(provider: OAuthProvider, accessToken: string, schema: Schema): Promise<InferOutput<Schema> | null>;

// Provider presets: plain records, ~15 LoC each — google + github, the
// top two. Adding one is a 15-LoC record in user code; no registry.
googleProvider: OAuthProvider;    // OIDC: openid email profile, PKCE on
githubProvider: OAuthProvider;    // /user, /access_token, PKCE tolerated

// ---------- TOTP

generateTotpSecret(): string;      // base32(20 random bytes)
totpAuthUri(secret: string, accountName: string, issuer: string,
            opts?: { digits?: number; stepSeconds?: number }): string;
// HMAC-SHA1, 6 digits, 30s step, ±1 window default. Constant-time code
// compare. RFC 6238/4226 vectors in tests.
verifyTotp(code: string, secret: string,
           opts?: { window?: number; stepSeconds?: number; digits?: number }): boolean;
```

### Why this shape

1. **Functions, zero classes (except the dev store).** Auth state lives in
   the caller's store; every crypto op is string-in/string-out or
   boolean-out. This is Lucia's lesson: the library is 150 LoC because it
   refuses to own state. The router precedent (`Context` et al.) allows
   classes where state exists — a session manager wrapper belongs in
   `examples/`, not the package.
2. **null-on-invalid, never-throw verify paths.** Auth handlers branch on
   null/boolean; try/catch around every verify is subset-legal but ugly and
   leaks stack noise into logs. Sign/exchange failures still throw (caller
   bugs), verify failures return null (attacker input — the distinction
   matters for alerting).
3. **Sync-friendly store contract.** Stores may return values or Promises;
   auth awaits regardless. `MemorySessionStore` and the future sqlite
   adapter pay one microtask; postgres/redis adapters work unchanged. This
   dodges the SC2009 promise-detection ban: we never sniff `.then`, we
   always `await`.
4. **Positional schema args, not chains** — the family convention
   (`prepare(sql, schema)` → `verifyJwtWith(token, key, schema)`,
   `fetchUserInfoWith(provider, token, schema)`). No `withSchema`
   method-shorthand (subset-banned), no builder objects.
5. **Self-describing password format** (`scrypt:N:r:p:salt:hash`) so
   parameter upgrades don't invalidate old hashes. `verifyPassword` reads
   the parameters from the string; `hashPassword` writes today's OWASP
   defaults.
6. **Provider presets are records, not a registry.** A provider is 15 LoC
   of URLs + scope. Better-auth's 80% is exactly the registry/plugin
   machinery this refuses to be.
7. **JWT alg from the key type.** `string` key ⇒ HS256, `KeyObject` ⇒
   ES256, overridable via `opts.alg`. Verify enforces the expected alg —
   no alg-confusion window, `none` hard-rejected.

### What we DON'T ship (and why)

| Dropped | Reason |
| --- | --- |
| `@oslojs/*` vendor | node:crypto 0.3.3 covers everything oslo provided (probe-verified static slice) |
| `cookies-tiny` vendor | We set 3 cookies and read 1; 80 LoC beats a jar dependency |
| jose | 50× size for HS256/ES256; JWE/JWKS/EdDSA are follow-ups, not v1 |
| WebAuthn | CBOR + 8 attestation formats; punt (child process or never) |
| TOTP + base32 | KISS cut; ~100 LoC of RFC 4648 machinery for a lower-tier pattern; follow-up ticket |
| Argon2 | Not in node:crypto; scrypt is the memory-hard default |
| Hono middleware reuse | Probed: hono/jwt fences (no WebCrypto in scriptc), MiddlewareHandler<E> never materializes (SC2001) |
| Magic links | Email outcall is the hard part; token part is session-pattern sugar. Follow-up |
| Refresh rotation | App logic; README documents the store-and-rotate pattern |
| JWKS client | Follow-up ticket; ~50 LoC + record-cache when asked for |
| Session manager class / `withSession` middleware | Belongs in `examples/`; the package stays stateless |
| Rate limiting | Orthogonal (router middleware); never inside auth |
| Plugin/provider registry, orgs/teams | better-auth's un-lowerable 80% |
| SAML, LDAP, OIDC certified flows | Enterprise surface; not the 20% |

## Implementation notes

- ~800 LoC core: session 150, cookie 80, password 70, csrf 50, jwt 140,
  oauth 190, memory store 50, errors/index 20. Provider presets +30.
  (TOTP+base32 cut: -150.)
- Imports: direct named imports from `node:crypto` (`createHash`,
  `randomBytes`, `timingSafeEqual`, `createHmac`, `createSign`,
  `createVerify`, `scryptSync`). Never `globalThis.crypto` — scriptc types
  it `unknown` (SC0001) and has no WebCrypto; probe-verified 2026-10-15,
  which is also why `hono/jwt` cannot be reused.
- No `?.`-chains into possibly-fenced builtins; note `toString(16)` on
  numbers is SC2012-fenced — hex conversion goes through a lookup table
  (probe finding from the hono/jwt attempt).
- ES256: `createSign("SHA256")` with `dsaEncoding: "ieee-p1363"` — JWS
  uses raw R||S, not DER. This is the classic interop bug; test vectors
  catch it.
- `timingSafeEqual` throws on length mismatch; all compares are
  length-pre-checked, then compared. No string `===` on secrets anywhere
  (grep gate in review checklist).
- base64url via `Buffer.from(bytes).toString("base64url")` — native,
  unpadded where the RFC requires (strip `=` for PKCE challenge and
  verifier).
- TOTP counter: REMOVED with TOTP.
- Token POST body: `new URLSearchParams({...})` — WHATWG class confirmed
  static in 0.3.3. Response parsed by `content-type`: JSON, else
  `URLSearchParams` parse.
- `Map`/`Set` are now allowed (0.3.3 probe, ban lifted) — `MemorySessionStore`
  uses a `Map` instead of record-sweep gymnastics.
- No spread on records (explicit key copies); no `?.`/`??`; no `for...in`;
  no method shorthand; `| null` only; indexed `for` loops.

## Testing strategy

1. **RFC vectors (the spine):**
   - PKCE: RFC 7636 Appendix B verifier→challenge pair, exact.
   - JWT: RFC 7515 Appendix A.1/A.3 (HS256/ES256) signatures + RFC 7519
     §3.1 example claims; round-trip against `jose`-generated tokens as
     cross-check (dev dependency, not shipped).
   - TOTP: RFC 6238 vectors (SHA1/8-digit across the time table) + RFC
     4226 HOTP Appendix D.
   - base32: RFC 4648 vectors.
2. **Session lifecycle** (`test/session.test.ts`): token round-trip,
   unknown/expired/malformed → null, sliding extension fires only past
   threshold, invalidate + invalidateAllForUser, MemorySessionStore TTL
   sweep.
3. **Password** (`test/password.test.ts`): round-trip, wrong password →
   false, legacy-parameter strings verify, malformed stored string →
   false (not throw).
4. **JWT edge** (`test/jwt.test.ts`): expired (±clockTolerance), wrong
   alg, `none` rejected, issuer/audience mismatch, ES256 P1363 vs DER
   (negative: DER signature must fail), tampered payload.
5. **OAuth** (`test/oauth.test.ts`): authorization URL construction
   (exact string fixtures per provider), token exchange against a stubbed
   `fetch` (JSON + urlencoded response shapes, non-2xx → null),
   userinfo with-schema parse + reject (test against BOTH @chttp/val and
   valibot schemas to prove the Standard-Schema seam).
6. **CSRF/cookies** (`test/csrf.test.ts`): double-submit match/mismatch/
   null legs, cookie serialization fixtures (all attributes, expiry
   cookie), origin allowlist.
7. **Router integration** (`test/router-integration.test.ts`): real
   dispatch — login handler sets cookie, protected route validates via
   `readCookie` + `validateSessionToken`, logout expires. Runs against
   BOTH transports: node:http `Ctx` and PR #56's `app.fetch(Request)`.
8. **Subset gate**: `scriptc coverage` 100%.
9. **ELF smoke** (`test/elf.test.sh`): `scriptc build` a program running
   the RFC vectors end-to-end (hash+verify password, full session
   round-trip against MemorySessionStore, sign+verify both algs,
   PKCE challenge), assert output.

Baseline per global rule 9c: capture `/tmp/chttp-auth-baseline-<ts>.log`
before iterating; diff before declaring done.

## File layout

```
packages/auth/
├── AGENTS.md              # subset bans + security checklist for contributors
├── README.md              # quickstart: session + login handler + OAuth flow
├── CHANGELOG.md
├── package.json           # name: @chttp/auth; dep: @chttp/val (workspace:^)
├── tsconfig.json          # subset-strict
├── src/
│   ├── index.ts           # re-exports
│   ├── session.ts         # tokens, store contract, lifecycle functions
│   ├── memory-store.ts    # MemorySessionStore (dev/test)
│   ├── cookie.ts          # serializeCookie, readCookie, prebuilt cookies
│   ├── password.ts        # scrypt hash/verify
│   ├── csrf.ts            # double-submit + origin check
│   ├── jwt.ts             # sign/verify/verifyJwtWith (HS256 | ES256)
│   ├── oauth.ts           # PKCE, authorization URL, token exchange, userinfo
│   ├── providers.ts       # google, github, discord records
│   ├── totp.ts            # secret gen, otpauth URI, verify
│   ├── base32.ts          # RFC 4648 encode/decode (TOTP only)
│   └── errors.ts          # code-string errors (E_NO_KEY, E_BAD_PARAMS, ...)
└── test/
    ├── session.test.ts
    ├── password.test.ts
    ├── jwt.test.ts
    ├── oauth.test.ts
    ├── csrf.test.ts
    ├── totp.test.ts      # RFC vectors
    ├── vectors.test.ts   # PKCE/base32/JWT RFC fixtures
    ├── router-integration.test.ts
    ├── coverage.test.mjs
    └── elf.test.sh
```

## Dependencies

- `@chttp/val` (`workspace:^`) — used by `verifyJwtWith` and
  `fetchUserInfoWith` only. Family precedent (DB packages) made val
  mandatory; auth keeps it a regular dep for consistency and because
  untrusted-claims validation is the #1 JWT footgun.
- Zero other runtime deps. `node:crypto`, `fetch`, `URL`, `URLSearchParams`
  are all confirmed static in scriptc 0.3.3.
- Dev: `@chttp/router` (integration test), `jose` (cross-check vectors
  only, never shipped).
- Note: `@cutils/url` deliberately NOT a dependency — OAuth URLs use
  WHATWG `URL` + `searchParams` directly; token bodies use
  `URLSearchParams`. Keeps auth standalone.

## Scope discipline

- **Do not** add a session-manager class, middleware, or `c`-aware
  helpers. Those are `examples/auth-demo/`.
- **Do not** grow JWT past HS256/ES256 or past JWS. JWE/JWKS/EdDSA are
  separate tickets with their own demand case.
- **Do not** add providers to core past the three presets. New providers
  are 15-LoC records users define inline; a growing registry is the
  better-auth trap.
- **Do not** add Argon2 via FFI in this package. If it ever lands it is
  `@cutils/*` territory with its own risk register.
- **Do not** accept a sync-only store contract change without an async
  story — the await-everything seam is what keeps postgres/redis adapters
  possible without forking the API.
- **Do not** let `verifyJwt` family throw. Null-return is the contract;
  callers must be able to branch without try/catch.
- Every compare on secret material goes through `timingSafeEqual` —
  no regressions to `===`, ever (checklist item in review).

## Bench cell (required before any perf claim)

`bench/cells/auth-elf.yml` — scrypt hash/verify at default params,
session validate (sha256 + memory store hit), HS256 verify, vs jose and
lucia-equivalent under Node 24. v1 ships without perf claims (same as
`@cutils/url`).

## Security checklist (gate before release)

- [ ] All secret compares: length pre-check + `timingSafeEqual`.
- [ ] `verifyPassword` runs a dummy hash on malformed stored strings
      (flattens timing on corrupt rows).
- [ ] Tokens ≥ 256 bits of entropy; store keys are SHA-256 of full token.
- [ ] Cookie defaults: HttpOnly (session), SameSite=Lax, Path=/,
      Secure=true default, MaxAge bound to session TTL.
- [ ] CSRF cookie NOT HttpOnly (double-submit JS read) — documented why.
- [ ] JWT: alg enforced, `none` rejected, exp/iat numeric-date seconds,
      leeway bounded (default 0, max documented).
- [ ] OAuth state validated before code exchange in examples; package
      docs show the state-cookie pattern.
- [ ] No secrets or provider bodies in error paths (null-return + generic
      log line documented).
- [ ] OWASP scrypt parameters (N=2^17, r=8, p=1) as defaults, embedded in
      the hash string for forward upgrades.
- [ ] `grep -n "=== " src/` review: no secret material on either side.

## Risk register

- **Timing-equal implementation slip** (a `===` sneaks into a compare).
  Mitigation: security checklist grep gate + a test that asserts compare
  time does not short-circuit (statistical, lenient bounds, CI-tolerant).
- **ES256 DER/P1363 interop.** The classic bug. Mitigation: RFC 7515
  Appendix A.3 vector + jose cross-check in tests; DER negative test.
- **Provider endpoint drift** (GitHub renames /access_token etc.).
  Mitigation: presets are data; fix is a one-line PR. Integration example
  pinned in `examples/auth-demo` exercises the Google flow live (manual
  gate, not CI).
- **Sync-store microtask cost** surprises a hot-path user. Mitigation:
  README performance note ("validateSessionToken costs one microtask on
  sync stores; the SHA-256 dominates").
- **val type-brand ticket not landed** ⇒ `verifyJwtWith` return type via
  Standard-Schema `InferOutput` is best-effort for @chttp/val schemas
  until the `_t!: T` brand lands. Runtime is unaffected. Same blocker as
  the DB family; not a v1 blocker.
- **Scriptc WebCrypto absence** means any future feature that needs it
  (WebAuthn at scale, JOSE interop) is blocked at the compiler level,
  not by us. Track scriptc upstream; do not shim.
- **Memory store used in production.** Mitigation: class docblock + README
  bold warning + `dev only` JSDoc. No runtime warning (subset-clean, quiet).
- **Subset regression.** `scriptc coverage` 100% gate in CI.

## Cross-cutting (ripples)

- **`@chttp/router`** — unchanged. Auth functions are plain async
  functions; handlers return their Promises and dispatch's `settleChain`
  awaits. No router API additions.
- **`@chttp/val`** — not a runtime dep (Standard-Schema seam). Seam-proof
  tests consume it and valibot as dev deps.
- **`@cutils/sqlite`** — natural `SessionStore` adapter (`key TEXT PRIMARY
  KEY` = sha256 hex). Adapter example ships with whichever package lands
  second.
- **`@cutils/url`** — no dependency (deliberate; documented above), but
  `buildQuery`'s canonical output is referenced in the README's
  SigV4-adjacent notes if users compose.
- **`examples/`** — `examples/auth-demo/`: password login + session
  cookie + Google OAuth + CSRF-protected form, all against
  `@chttp/router` on both transports. This is the real documentation.
- **CHANGELOG/CI** — seventh package in the fixed-version group; release
  workflow needs no change (`release.yml` verifies all package.jsons).

## Task breakdown

### T0 — Plan, ticket, wiring (S, infra)
- [ ] Create GitHub issue "Ship @chttp/auth v0.1.0" (iteration, effort M,
      dates, classification: feature). Effort M, not S: security surface.
- [ ] Link from `.agents/decisions.md` once shipped.

### T1 — Foundations (S, feature)
- [ ] `base32.ts` (RFC 4648 vectors), `errors.ts`, `cookie.ts`
      (serialization fixtures).

### T2 — Password + CSRF (S, feature)
- [ ] `password.ts` (scrypt format, OWASP defaults, dummy-hash flatten),
      `csrf.ts` (double-submit, origin check). Tests.

### T3 — Sessions (M, feature)
- [ ] `session.ts` + `memory-store.ts`: token gen, store contract,
      lifecycle, sliding expiry. Tests incl. MemorySessionStore sweep.

### T4 — JWT (M, feature)
- [ ] `jwt.ts`: sign/verify HS256+ES256, `verifyJwtWith`. RFC vectors +
      jose cross-check + DER negative test.

### T5 — OAuth (M, feature)
- [ ] `oauth.ts` + `providers.ts`: PKCE, URLs, exchange, userinfo(With).
      Stubbed-fetch tests, URL fixtures.

### T6 — TOTP (S, feature)
- [ ] `totp.ts`: RFC 6238/4226 vectors, otpauth URI.

### T7 — Gates (S, infra)
- [ ] `coverage.test.mjs`, `elf.test.sh`, `router-integration.test.ts`.
- [ ] Security checklist run + grep gate. README, AGENTS.md,
      `pnpm change` intent.

### T8 — Follow-ups (separate tickets)
- [ ] `examples/auth-demo/` full flow app.
- [ ] Bench cell `bench/cells/auth-elf.yml`.
- [ ] JWKS fetch+record-cache client (demand-gated).
- [ ] sqlite/postgres `SessionStore` adapters (coordinate with DB family).
- [ ] Magic-link token primitives (if email outcall pattern settles).

## References

- Lucia session pattern (the model):
  `https://thecopenhagenbook.com/` + lucia blog "Updated session
  implementation" (tokens, hashing, sliding expiry).
- RFC 6749 (OAuth2), RFC 7636 (PKCE; Appendix B vector).
- RFC 7515 (JWS; A.1/A.3 vectors), RFC 7519 (JWT claims).
- RFC 6238 (TOTP vectors), RFC 4226 (HOTP; Appendix D).
- RFC 4648 (base32).
- OWASP Password Storage Cheat Sheet (scrypt parameters).
- Landscape assessment: `memory:auth-landscape-assessment.md`.
- scriptc 0.3.3 crypto surface: `memory:scriptc_ground_truth.md`.
- better-auth LoC analysis (the 80/20 argument): same landscape memory.
