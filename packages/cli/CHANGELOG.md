# @cutils/cli

## 0.8.0

## 0.7.0

### Minor Changes

- v1 spec surface: optional/variadic/schema'd positionals (ArgSpec + ArgsFromSpec tuple typing), optionalValue/variadic/negatable/env/camelCase/hidden options, nested subcommand trees + program-level node + aliases + help walk, runAsync for async handlers and validators — plus bench/apps cells (~840k ops/s vs commander's ~460k)

- elf consumer entry: ./elf export + JSDoc contract fixes SC9001 nullT

## 0.6.0

### Minor Changes

- Initial release: Standard-Schema-first declarative CLI builder (`command`/`run` + `str`/`num`/`int`/`bool` builtins) — `opts` types derive entirely from the schema's `types.output` channel; validators own all coercion and errors; compiles statically into the app ELF.
