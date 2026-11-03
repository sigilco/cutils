# @cutils/ffi AGENTS.md

Shared scriptc FFI spec + Rust struct echo. Models on `@cutils/sqlite` for
packaging; the ABI **is** sqlite's (format 7, span strings/bytes).

## Commands

- `pnpm build` — cargo test + release staticlib/cdylib, copy into `build/`,
  `tsc` → `dist/`, `elf/shims.d.ts`
- `pnpm test` — `test:c` (archive), `test:node` (koffi), coverage gate,
  `elf.test.sh`, `consumer-elf.test.sh`

## Layout

- `native/` — `cutils-ffi-echo` crate (`staticlib` + `cdylib`). `EchoPoint`
  is `#[repr(C)]`; `echo_point` uses the span ABI.
- `vendor/manifest.json`, `gate.ffi.json`, `ffi.json` — same `functions`
  and `system_libraries`; only `libraries` differs (repo / gate / installed).
- `src/internal/ffi.ts` — `declare function` block matching the manifest.
- `src/spec.ts` — format-7 TypeScript types (`FfiManifest`).
- `src/buffer.ts` / `src/layout.ts` — sqlite-style scratch helpers and LE
  field accessors. Do not introduce a Scratch class.
- `scripts/copy-shared.mjs` — copies cargo's cdylib under the platform name
  (`.so` / `.dylib`); cargo's output name is not platform-stable.

## Package-specific subset rules

Same as root AGENTS.md. Additional:

- No struct returns from FFI. Pack/unpack through `Uint8Array`.
- `EchoPoint.value` is `bigint` (format-7 `i64`). Do not widen it to `number`.
- Keep `gate.ffi.json` / `ffi.json` / `vendor/manifest.json` function lists
  in lockstep with `src/internal/ffi.ts` and `native/src/lib.rs`.

## Pitfalls

- `elf/shims.d.ts` is generated; ambient `declare function` only applies from
  the consumer's program (same sqlite packaging trap).
- Rust `staticlib` needs `system_libraries: ["pthread", "dl", "m"]`.
- `panic = "abort"` in release so the archive does not pull unwind runtime.
- The crate stays plain `#[no_mangle] pub extern "C"` + `#[repr(C)]`. **No
  uniffi, no cbindgen, no wasm/component-model**: scriptc reads manifests,
  not headers, and format 7 has no struct class — a generated binding would
  describe an ABI scriptc cannot express.
- `src/spec.ts` mirrors scriptc's three per-position class sets
  (`FFI_PARAM_CLASSES` / `FFI_RETURN_CLASSES` /
  `FFI_CALLBACK_PARAM_CLASSES` in scriptc's
  `packages/compiler/src/ffi/ffi-manifest.ts`). Do NOT collapse them into one
  union: `string`/`bytes` are never returns, `mutable-bytes` is outbound-only,
  and `cstring` is callback-only. A single union would accept manifests
  scriptc rejects.
- Do not add `@cutils/pty` or `@cutils/keyring` in this package; they are
  follow-up crates that **consume** this ABI.
