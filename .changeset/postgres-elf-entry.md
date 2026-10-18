---
"@cutils/postgres": minor
---

Fix npm-consumer `scriptc build`: ship `./elf` export (dist JS compiled via `--npm-static`) plus JSDoc annotations the JS inference needs — definite field initializers, `import("./x.js").T` cross-file types, inline literal object types where `.d.ts` interfaces can't be named, `unknown[]` casts after `Array.isArray`, and a declared dictionary type for dynamic-key row writes. New `test/consumer-elf.test.sh` packs the tarball and builds a scratch app against it.
