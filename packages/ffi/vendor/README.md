# vendor/

`manifest.json` is the repo-layout copy of the format-7 FFI spec (`libraries`
points at `../build/libcutils_ffi_echo.a`). `gate.ffi.json` and `ffi.json` must
keep the same `functions` and `system_libraries`. The native implementation is
the Rust crate in `../native/`, not a C amalgamation.
