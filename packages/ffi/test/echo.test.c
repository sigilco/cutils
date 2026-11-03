/* C-level assertions over build/libcutils_ffi_echo.a. Span ABI: every
 * bytes arg is a (ptr, len) pair, every out param a caller-owned buffer. */

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../native/echo.h"

int main(void) {
  uint8_t in[24];
  uint8_t out[24];
  int32_t n;
  int32_t x;

  assert(echo_size() == 24);
  assert(echo_i32(41) == 41);
  assert(echo_i32(-8) == -8);
  assert(echo_i64(99) == 99);
  assert(echo_i64(-7) == -7);

  memset(in, 0, sizeof(in));
  /* x = 41 (LE) */
  in[0] = 41;
  /* y = -2 */
  in[4] = 0xfe;
  in[5] = 0xff;
  in[6] = 0xff;
  in[7] = 0xff;
  /* flags = 7 */
  in[8] = 7;
  /* value = 99 at offset 16 */
  in[16] = 99;

  n = echo_point(in, sizeof(in), out, sizeof(out));
  assert(n == 24);
  memcpy(&x, out, 4);
  assert(x == 42);
  assert(out[4] == 0xfe);
  assert(out[8] == 7);
  assert(out[16] == 99);

  n = echo_point(in, 8, out, sizeof(out));
  assert(n == -1);
  n = echo_point(in, sizeof(in), out, 8);
  assert(n == 24);

  printf("echo.test.c OK\n");
  return 0;
}
