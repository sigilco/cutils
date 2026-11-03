//! Format-7 span-ABI echo of a `#[repr(C)]` struct.
//!
//! `string`/`bytes` arrive as `(ptr, len)`; `mutable-bytes` as `(buf, len)`.
//! Matches `packages/sqlite/vendor/shim/sqlite_shim.c`.

use core::mem::size_of;
use core::ptr;

/// Little-endian host layout (x86_64 / aarch64). Size is 24: 4 bytes of
/// padding sit between `flags` and `value` so `i64` is 8-aligned.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct EchoPoint {
    pub x: i32,
    pub y: i32,
    pub flags: u32,
    pub value: i64,
}

pub const ECHO_POINT_SIZE: usize = 24;

#[no_mangle]
pub extern "C" fn echo_size() -> i32 {
    size_of::<EchoPoint>() as i32
}

#[no_mangle]
pub extern "C" fn echo_i32(value: i32) -> i32 {
    value
}

#[no_mangle]
pub extern "C" fn echo_i64(value: i64) -> i64 {
    value
}

/// Copy `EchoPoint` from `in` into `out`, adding 1 to `x` so a successful
/// call cannot be a JS-side memcpy. Return convention matches sqlite's
/// buffer-out: `>= 0` is required bytes; if it exceeds `out_len` nothing
/// is written. `-1` means the input span is too small.
#[no_mangle]
pub unsafe extern "C" fn echo_point(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    let n = size_of::<EchoPoint>() as i32;
    if in_ptr.is_null() || in_len < size_of::<EchoPoint>() {
        return -1;
    }
    if out_ptr.is_null() || out_len < size_of::<EchoPoint>() {
        return n;
    }
    let mut point = ptr::read_unaligned(in_ptr as *const EchoPoint);
    point.x = point.x.wrapping_add(1);
    ptr::write_unaligned(out_ptr as *mut EchoPoint, point);
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_24() {
        assert_eq!(size_of::<EchoPoint>(), ECHO_POINT_SIZE);
        assert_eq!(echo_size(), ECHO_POINT_SIZE as i32);
        assert_eq!(core::mem::offset_of!(EchoPoint, value), 16);
    }

    #[test]
    fn roundtrip_adds_one_to_x() {
        let input = EchoPoint {
            x: 41,
            y: -2,
            flags: 7,
            value: 99,
        };
        let mut in_buf = [0u8; ECHO_POINT_SIZE];
        let mut out_buf = [0u8; ECHO_POINT_SIZE];
        unsafe {
            ptr::write_unaligned(in_buf.as_mut_ptr() as *mut EchoPoint, input);
            let n = echo_point(
                in_buf.as_ptr(),
                in_buf.len(),
                out_buf.as_mut_ptr(),
                out_buf.len(),
            );
            assert_eq!(n, ECHO_POINT_SIZE as i32);
            let out = ptr::read_unaligned(out_buf.as_ptr() as *const EchoPoint);
            assert_eq!(out.x, 42);
            assert_eq!(out.y, -2);
            assert_eq!(out.flags, 7);
            assert_eq!(out.value, 99);
        }
    }
}
