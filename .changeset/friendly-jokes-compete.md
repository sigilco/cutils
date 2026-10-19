---
"@cutils/mongo": patch
---

mongo: keep int64 cursor ids lossless — getMore/killCursors re-encode the raw bigint, fixing CursorNotFound on multi-batch cursors (#32)
