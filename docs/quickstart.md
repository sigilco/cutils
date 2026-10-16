# Quickstart

Each package installs from npm and works the same under Node and under `scriptc build`:

```sh
pnpm add @cutils/sqlite   # embedded SQLite
pnpm add @chttp/cache     # LRU + TTL memory cache
```

::: tabs

== tab Node

```ts
import { Database } from "@cutils/sqlite";

using db = Database.openInMemory();
db.exec("CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT)");
```

== tab Native ELF

```sh
scriptc build src/main.ts --ffi packages/sqlite/vendor/manifest.json -o app
```

:::

Per-package usage lives on the package pages; subset rules for contributors live in `AGENTS.md`.
