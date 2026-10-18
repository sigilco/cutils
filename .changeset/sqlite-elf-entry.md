---
"@cutils/sqlite": minor
---

Fix npm-consumer `scriptc build`: ship `./elf` export (dist JS compiled via `--npm-static`), a consumer-facing `ffi.json` manifest, and `elf/shims.d.ts` ambient declarations; replace the `Scratch` class with `ensure`/`copyOut` helpers and move stmt/tx tracking to a module-level registry so no class instance crosses a module boundary.
