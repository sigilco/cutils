// Shared scriptc FFI manifest types, pinned to `ffi_format: 7` — the ABI
// `@cutils/sqlite` already ships (span strings/bytes, pointer-as-bigint).
// Downstream shims (pty, keyring, this package's echo crate) must match.
//
// Hand-written on purpose: the published `@scriptc/compiler` types describe
// the RESOLVED profile (camelCase `ffiFormat`/`systemLibraries`), not the
// authored JSON (snake_case `ffi_format`/`system_libraries`), and the root
// `callbacks` array has no exported type at all.
//
// Normative sources:
//   https://github.com/vercel-labs/scriptc/blob/main/docs/content/docs/ffi.mdx
//   packages/compiler/src/ffi/ffi-manifest.ts — `FFI_PARAM_CLASSES`,
//   `FFI_RETURN_CLASSES`, `FFI_CALLBACK_PARAM_CLASSES`.
//
// The three per-position class sets differ on purpose: `string`/`bytes` are
// never returns, `mutable-bytes` is outbound-only, and `cstring` is
// callback-only. One shared union would let TypeScript accept a manifest
// scriptc rejects.

export const FFI_FORMAT = 7;

/** Classes a native function may take as a plain parameter. */
export type FfiParamClass =
  | "bool"
  | "f32"
  | "f64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "pointer"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "string"
  | "bytes"
  | "mutable-bytes";

/** Classes a native function may return. */
export type FfiReturnClass =
  | "bool"
  | "f32"
  | "f64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "pointer"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "void";

/** Classes a callback may take. */
export type FfiCallbackParamClass =
  | "bool"
  | "cstring"
  | "f32"
  | "f64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "pointer"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "string"
  | "bytes";

/** A compiler-supplied context slot; it consumes no TypeScript argument. */
export interface FfiContextParam {
  context: string;
}

/** The native callback ABI a function parameter carries. */
export interface FfiCallbackDecl {
  /** Unique within the containing native function. */
  id: string;
  params: (FfiCallbackParamClass | FfiContextParam)[];
  returns: FfiReturnClass;
  lifetime: "call" | "retained";
  invoke?: "script-thread" | "foreign";
}

/** A callback parameter: the native function-pointer slot. */
export interface FfiCallbackParam {
  callback: FfiCallbackDecl;
}

/** A release parameter naming a retained descriptor `<binding>:<callback-id>`. */
export interface FfiReleaseParam {
  callback: {
    release: string;
  };
}

/** One parameter slot of a native function. */
export type FfiParam = FfiParamClass | FfiCallbackParam | FfiReleaseParam | FfiContextParam;

export interface FfiFunctionDecl {
  /** TypeScript binding name; must be a plain identifier. */
  name: string;
  /** C symbol linked into the executable. */
  symbol: string;
  params: FfiParam[];
  returns: FfiReturnClass;
  /** node:ffi.dlopen library name; format 7, scalar/pointer signatures only. */
  library?: string;
}

export interface FfiManifest {
  ffi_format: 7;
  functions: FfiFunctionDecl[];
  libraries: string[];
  system_libraries: string[];
  /** Darwin framework names; never raw linker flags. */
  frameworks?: string[];
}
