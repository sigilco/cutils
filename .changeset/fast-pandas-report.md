---
"@cutils/sqlite": patch
---

Fix empty string/blob binds landing as SQL NULL (empty span marshals as NULL pointer; shim substitutes a non-NULL literal)
