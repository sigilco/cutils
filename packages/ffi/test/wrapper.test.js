import "./koffi-binding.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEchoPoint,
  echoI32,
  echoI64,
  echoPoint,
  echoSize,
  encodeEchoPoint,
  ECHO_POINT_SIZE,
  FFI_FORMAT,
} from "../dist/esm/index.js";

test("format 7 constant and native size", () => {
  assert.equal(FFI_FORMAT, 7);
  assert.equal(echoSize(), ECHO_POINT_SIZE);
});

test("scalar echo", () => {
  assert.equal(echoI32(41), 41);
  assert.equal(echoI32(-8), -8);
  assert.equal(echoI64(99n), 99n);
  assert.equal(echoI64(-7n), -7n);
});

test("layout roundtrip without native", () => {
  const packed = encodeEchoPoint({ x: 1, y: -2, flags: 3, value: 99n });
  assert.equal(packed.length, 24);
  const decoded = decodeEchoPoint(packed);
  assert.equal(decoded.x, 1);
  assert.equal(decoded.y, -2);
  assert.equal(decoded.flags, 3);
  assert.equal(decoded.value, 99n);
});

test("Rust struct echo adds 1 to x", () => {
  const out = echoPoint({
    x: 41,
    y: -2,
    flags: 7,
    value: 1234567890123n,
  });
  assert.equal(out.x, 42);
  assert.equal(out.y, -2);
  assert.equal(out.flags, 7);
  assert.equal(out.value, 1234567890123n);
});
