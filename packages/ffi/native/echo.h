#ifndef CUTILS_FFI_ECHO_H
#define CUTILS_FFI_ECHO_H

#include <stddef.h>
#include <stdint.h>

int32_t echo_size(void);
int32_t echo_i32(int32_t value);
int64_t echo_i64(int64_t value);
int32_t echo_point(const uint8_t *in_ptr, size_t in_len, uint8_t *out_ptr,
                   size_t out_len);

#endif
