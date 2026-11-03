// @cutils/ffi — shared scriptc format-7 FFI spec + layout helpers, plus a
// Rust struct-echo smoke used as the package's ELF proof.

export { copyOut, ensure } from "./buffer.ts";
export {
  decodeEchoPoint,
  echoI32,
  echoI64,
  echoPoint,
  echoSize,
  encodeEchoPoint,
  ECHO_POINT_SIZE,
  ECHO_POINT_VALUE_OFFSET,
} from "./echo.ts";
export type { EchoPoint } from "./echo.ts";
export { readI32, readI64, readU32, writeI32, writeI64, writeU32 } from "./layout.ts";
export { FFI_FORMAT } from "./spec.ts";
export type {
  FfiCallbackDecl,
  FfiCallbackParam,
  FfiCallbackParamClass,
  FfiContextParam,
  FfiFunctionDecl,
  FfiManifest,
  FfiParam,
  FfiParamClass,
  FfiReleaseParam,
  FfiReturnClass,
} from "./spec.ts";
