// scriptc coverage gate for @cutils/ffi: pack/echo a Rust EchoPoint.
// test/elf.test.sh builds this file with `scriptc build --ffi gate.ffi.json`.

import {
  decodeEchoPoint,
  echoI32,
  echoI64,
  echoPoint,
  echoSize,
  encodeEchoPoint,
  ECHO_POINT_SIZE,
  ECHO_POINT_VALUE_OFFSET,
  FFI_FORMAT,
} from "./src/index.ts";
import type { EchoPoint, FfiCallbackDecl, FfiManifest } from "./src/index.ts";

function check(cond: boolean, name: string): void {
  if (!cond) {
    throw new Error("gate FAIL: " + name);
  }
}

function main(): void {
  check(FFI_FORMAT === 7, "ffi_format 7");
  check(echoSize() === ECHO_POINT_SIZE, "echo_size matches TS constant");
  check(ECHO_POINT_VALUE_OFFSET === 16, "i64 offset");

  check(echoI32(41) === 41, "echo_i32");
  check(echoI32(-8) === -8, "echo_i32 negative");
  check(echoI64(BigInt(99)) === BigInt(99), "echo_i64");
  check(echoI64(BigInt(-7)) === BigInt(-7), "echo_i64 negative");

  const input: EchoPoint = {
    x: 41,
    y: -2,
    flags: 7,
    value: BigInt("1234567890123"),
  };
  const packed = encodeEchoPoint(input);
  check(packed.length === ECHO_POINT_SIZE, "packed size");
  const unpacked = decodeEchoPoint(packed);
  check(unpacked.x === 41, "local x");
  check(unpacked.y === -2, "local y");
  check(unpacked.flags === 7, "local flags");
  check(unpacked.value === input.value, "local value");

  const echoed = echoPoint(input);
  check(echoed.x === 42, "native x+1");
  check(echoed.y === -2, "native y");
  check(echoed.flags === 7, "native flags");
  check(echoed.value === input.value, "native value");

  const manifest: FfiManifest = {
    ffi_format: 7,
    functions: [
      {
        name: "echo_size",
        symbol: "echo_size",
        params: [],
        returns: "i32",
      },
      {
        name: "echo_point",
        symbol: "echo_point",
        params: ["bytes", "mutable-bytes"],
        returns: "i32",
      },
    ],
    libraries: ["./build/libcutils_ffi_echo.a"],
    system_libraries: ["pthread", "dl", "m"],
  };
  check(manifest.ffi_format === 7, "manifest type");
  check(manifest.functions.length === 2, "manifest functions");
  check(manifest.functions[1].params[1] === "mutable-bytes", "outbound-only span class");
  const callback: FfiCallbackDecl = {
    id: "onEcho",
    params: ["i32", { context: "onEcho" }],
    returns: "void",
    lifetime: "call",
  };
  check(callback.params.length === 2, "callback decl accepts i32 + context");

  console.log("gate OK");
}

main();
