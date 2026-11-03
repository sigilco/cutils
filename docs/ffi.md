# @cutils/ffi

Shared scriptc FFI spec used by `@cutils/sqlite` and by later native packages (`pty`, `keyring`). Format 7, span ABI, structs packed as `bytes`/`mutable-bytes`.

## Surface

| API | Notes |
| --- | --- |
| `FFI_FORMAT` | `7` — the format every manifest here declares |
| `FfiManifest`, `FfiFunctionDecl` | the authored JSON shape (snake_case `ffi_format`) |
| `FfiParamClass`, `FfiReturnClass`, `FfiCallbackParamClass` | scriptc's three per-position class sets |
| `writeI32` / `writeU32` / `writeI64` / `readI32` / `readU32` / `readI64` | little-endian field accessors |
| `ensure` / `copyOut` | scratch helpers for `mutable-bytes` out params |
| `encodeEchoPoint` / `decodeEchoPoint` / `echoPoint` | the Rust `EchoPoint` proof, packed and unpacked |

The class sets differ on purpose: `string` and `bytes` are never returns, `mutable-bytes` is outbound-only, and `cstring` is callback-only. One shared union would let TypeScript accept a manifest scriptc rejects.

## ABI classes

| Manifest class | TypeScript | Native C/Rust |
| --- | --- | --- |
| `i32` / `u32` / `f64` / … | `number` | matching scalar |
| `i64` / `u64` / `pointer` | `bigint` | `i64` / `u64` / `void *` |
| `string` / `bytes` | `string` / `Uint8Array` | `(const uint8_t *data, size_t len)` — not NUL-terminated |
| `mutable-bytes` | `Uint8Array` | `(uint8_t *buf, size_t len)`, caller-owned |

Buffer-out convention: return `>= 0` required bytes; if that exceeds `len`, write nothing and let the wrapper grow. `-1` is a domain null or an input error.

Structs are not a manifest type. `EchoPoint` is 24 bytes on little-endian hosts: `i32 x`, `i32 y`, `u32 flags`, 4 bytes of padding, `i64 value`.

## Compile to ELF

```sh
cp node_modules/@cutils/ffi/elf/shims.d.ts ./shims.d.ts
scriptc build app.ts --npm-static @cutils/ffi \
  --ffi node_modules/@cutils/ffi/ffi.json
```

`ffi.json` points at the shipped `./build/libcutils_ffi_echo.a`. Do not pass `vendor/manifest.json` from a consumer — its `libraries` path is repo-layout.

See the package [README](https://github.com/sigilco/cutils/tree/main/packages/ffi) for the full ELF compile recipe and the echo smoke.
