# @cutils/ffi

Shared [scriptc](https://github.com/vercel-labs/scriptc) FFI shim spec — the same **format 7 span ABI** `@cutils/sqlite` already uses — plus little-endian layout helpers and a tiny Rust crate that echoes a `#[repr(C)]` struct. The same TypeScript runs under Node (koffi) and compiles through `scriptc build --ffi` into a static ELF.

This is not a replacement for scriptc's linker or for Node-API. Outbound FFI stays `declare function` + a JSON manifest. This package names the ABI so pty/keyring/T3 forks do not invent a second one. The Rust crate is deliberately plain `#[no_mangle] extern "C"` + `#[repr(C)]` — no uniffi, cbindgen, or wasm component model — because scriptc reads manifests, not headers, and format 7 has no struct class. That keeps the archive usable from scriptc ELFs, koffi/node-ffi, C, C++, C# P/Invoke and Python ctypes alike.

`src/spec.ts` mirrors scriptc's **per-position class sets** (`FfiParamClass`, `FfiReturnClass`, `FfiCallbackParamClass`): `string`/`bytes` are never returns, `mutable-bytes` is outbound-only, and `cstring` is callback-only. The types reject what scriptc rejects — see scriptc's `docs/content/docs/ffi.mdx` (normative) and `packages/compiler/src/ffi/ffi-manifest.ts`.

```ts
import { echoI32, echoPoint, FFI_FORMAT } from "@cutils/ffi";

echoI32(41); // 41
const out = echoPoint({ x: 41, y: -2, flags: 7, value: 99n });
out.x; // 42 — native decoded the struct and added 1
```

## ABI (format 7)

Copied from sqlite's shim, not a new convention:

| Manifest type             | TypeScript              | Native C/Rust                                                |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| `i32` / `u32` / `f64` / … | `number`                | matching scalar                                              |
| `i64` / `u64` / `pointer` | `bigint`                | `i64` / `u64` / `void *`                                     |
| `string` / `bytes`        | `string` / `Uint8Array` | `(const uint8_t *data, size_t len)` — **not** NUL-terminated |
| `mutable-bytes`           | `Uint8Array`            | `(uint8_t *buf, size_t len)` caller-owned                    |

Buffer-out convention (sqlite, reused here): return `>= 0` required bytes; if that exceeds `len`, write nothing and let the wrapper grow. `-1` is a domain null / input error.

Structs are **not** a manifest type. Pack them with `writeI32`/`writeI64` into `bytes`, unpack from `mutable-bytes`. `EchoPoint` is 24 bytes on LE: `i32 x`, `i32 y`, `u32 flags`, 4 bytes padding, `i64 value`.

## Compile to ELF

```ts
/// <reference path="./shims.d.ts" />
import { echoPoint } from "@cutils/ffi/elf";
```

```sh
cp node_modules/@cutils/ffi/elf/shims.d.ts ./shims.d.ts
scriptc build app.ts --npm-static @cutils/ffi \
  --ffi node_modules/@cutils/ffi/ffi.json
```

`ffi.json` points at the shipped `./build/libcutils_ffi_echo.a`. Do not pass `vendor/manifest.json` from a consumer — its `libraries` path is repo-layout.

## Node

`@cutils/ffi/node-binding` loads `build/libcutils_ffi_echo.so` (`.dylib` on macOS) through optional peer `koffi` and installs the `echo_*` globals the emitted JS calls. Tests do this automatically; apps that stay on Node should import the binding once at startup.
