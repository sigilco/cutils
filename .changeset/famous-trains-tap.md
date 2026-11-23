---
"@cutils/sqlite": patch
---

fix(sqlite): build:shared is platform-aware via scripts/build-shared.sh — -dynamiclib on Mach-O, keeps -Wl,-Bsymbolic -shared on ELF
