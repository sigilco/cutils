#!/usr/bin/env bash
# Build test/elf-app.ts to a native ELF (scriptc build) and run the full
# CLI validation matrix through it: flags, help, version, and every error
# path. Requires `pnpm install` at the workspace root (scriptc is a root
# devDependency).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail() {
  echo "elf-cli-smoke FAIL: $*" >&2
  exit 1
}

# Prefer the workspace-root binary; fall back to PATH.
BIN="scriptc"
if [ -x ../../node_modules/.bin/scriptc ]; then
  BIN="../../node_modules/.bin/scriptc"
fi
"$BIN" build test/elf-app.ts -o "$T/cli-elf" >/dev/null || fail "scriptc build"
echo "build OK"

# expect <exit-code> <stdout-substring> <argv...>
expect() {
  local want_code="$1" want_out="$2"
  shift 2
  local out code
  set +e
  out="$("$T/cli-elf" "$@" 2>"$T/err")"
  code=$?
  set -e
  [ "$code" = "$want_code" ] || fail "argv [$*]: exit $code, want $want_code (out: $out, err: $(cat "$T/err"))"
  case "$out" in
    *"$want_out"*) ;;
    *) fail "argv [$*]: stdout missing '$want_out' (got: $out)" ;;
  esac
}

# expect_err <exit-code> <stderr-substring> <argv...>
expect_err() {
  local want_code="$1" want_err="$2"
  shift 2
  local out code
  set +e
  out="$("$T/cli-elf" "$@" 2>"$T/err")"
  code=$?
  set -e
  [ "$code" = "$want_code" ] || fail "argv [$*]: exit $code, want $want_code"
  case "$(cat "$T/err")" in
    *"$want_err"*) ;;
    *) fail "argv [$*]: stderr missing '$want_err' (got: $(cat "$T/err"))" ;;
  esac
}

expect 0 "hello world" greet world
expect 0 "HELLO WORLD" greet -u world
expect 0 "hi there" greet --greeting hi --times 2 there
expect 0 "4" add 1.5 2.5
expect 0 "Usage: demo <command>" --help
expect 0 "Usage: demo <command>"
expect 0 "demo 1.0.0" --version
expect 0 "-u, --upper" greet --help
expect 0 "(default: 1)" greet --help
expect_err 1 "missing required argument 'name'" greet
expect_err 1 "expected a number, got 'abc'" greet --times abc x
expect_err 1 "unknown option '--bogus'" greet --bogus x
expect_err 1 "did you mean 'greet'?" gret x
expect_err 1 "unexpected argument" greet a b
expect_err 1 "expected an integer <= 10, got 99" greet --times 99 x

echo "elf-cli-smoke OK"
