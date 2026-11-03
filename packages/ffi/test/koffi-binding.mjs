// Installs the `echo_*` globals the emitted dist/esm/internal/ffi.js calls,
// backed by the shared build (build/libcutils_ffi_echo.{so,dylib}) through
// koffi. Span ABI: bytes/mutable-bytes cross as (ptr,len) pairs.

import koffi from "koffi";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const shared = process.platform === "darwin" ? "dylib" : "so";
const lib = koffi.load(path.join(dir, "..", "build", `libcutils_ffi_echo.${shared}`));

const g = globalThis;

const f = {
  size: lib.func("int32 echo_size()"),
  i32: lib.func("int32 echo_i32(int32 value)"),
  i64: lib.func("int64 echo_i64(int64 value)"),
  point: lib.func(
    "int32 echo_point(const uint8_t *in_ptr, uint64 in_len, uint8_t *out_ptr, uint64 out_len)",
  ),
};

g.echo_size = () => f.size();
g.echo_i32 = (value) => f.i32(value);
// koffi hands an int64 back as a JS number when it fits the safe range and
// as a bigint otherwise; the wrapper normalizes to bigint.
g.echo_i64 = (value) => {
  const out = f.i64(value);
  return typeof out === "bigint" ? out : BigInt(out);
};
g.echo_point = (input, output) =>
  f.point(input, BigInt(input.length), output, BigInt(output.length));
