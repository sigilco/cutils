// Shared capture helper for @cutils/cli tests: run() writes help to
// console.log and errors to console.error, so tests collect both.
export function capture(fn) {
  const out = [];
  const err = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (m) => out.push(String(m));
  console.error = (m) => err.push(String(m));
  try {
    return { code: fn(), out, err };
  } finally {
    console.log = ol;
    console.error = oe;
  }
}
