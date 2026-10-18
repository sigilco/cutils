---
"@cutils/mongo": patch
---

mongo: insertOne builds the generated-_id document via toBsonDoc — direct tagged-literal store trips SC9001 under scriptc
