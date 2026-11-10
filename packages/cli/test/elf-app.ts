// ELF smoke app for @cutils/cli — compiled with `scriptc build` by
// test/elf.test.sh. `greet` exercises the bool/num/str builtins + short
// flags; `add` exercises required positionals; `tags` exercises a variadic
// positional + variadic option + camelCase opts keys; `opt` exercises
// optionalValue, negatable flags and env fallback; `deploy` is a subcommand
// group (nested descent + alias); `slow` has an async handler — the entry
// dispatches to runAsync for it.

import { bool, command, int, run, runAsync, str } from "../src/index.ts";

const prog = {
  name: "demo",
  version: "1.0.0",
  description: "elf smoke demo",
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: bool({ short: "u", description: "uppercase output" }),
        times: int({ short: "t", default: 1, max: 10, description: "repeat n times" }),
        greeting: str({ short: "g", description: "greeting word" }),
      },
      handler: (opts, args) => {
        let who = args[0];
        let word = opts.greeting;
        if (word === "") {
          word = "hello";
        }
        if (opts.upper) {
          who = who.toUpperCase();
          word = word.toUpperCase();
        }
        for (let i = 0; i < opts.times; i++) {
          console.log(word + " " + who);
        }
      },
    }),
    add: command("add two numbers", {
      args: ["a", "b"],
      handler: (opts, args) => {
        console.log(String(Number(args[0]) + Number(args[1])));
      },
    }),
    tags: command("tag files", {
      args: [{ name: "files", variadic: true }],
      options: {
        tag: { variadic: true, description: "tag(s)" },
        "dry-run": bool({ short: "n", description: "no writes" }),
      },
      handler: (opts, args) => {
        const files: string[] = args[0];
        const tags: string[] = opts.tag;
        console.log(
          (opts.dryRun ? "dry " : "") +
            String(tags.length) +
            " tags on " +
            String(files.length) +
            " files",
        );
      },
    }),
    opt: command("optional and negated", {
      args: [{ name: "out", optional: true }],
      options: {
        color: { optionalValue: true, description: "color mode" },
        cache: { flag: true, negatable: true, default: true, description: "caching" },
        target: str({ env: "DEPLOY_TARGET", description: "deploy target" }),
      },
      handler: (opts, args) => {
        let color = "off";
        if (opts.color === true) {
          color = "auto";
        } else if (opts.color !== "") {
          color = String(opts.color);
        }
        console.log(
          "color=" +
            color +
            " cache=" +
            String(opts.cache) +
            " target=" +
            String(opts.target) +
            " out=" +
            String(args[0]),
        );
      },
    }),
    deploy: command("deploy things", {
      commands: {
        web: command("deploy web", {
          handler: () => {
            console.log("web deployed");
          },
        }),
        api: command("deploy api", {
          alias: "a",
          handler: () => {
            console.log("api deployed");
          },
        }),
      },
    }),
    slow: command("async handler", {
      handler: async (_opts, _args): Promise<void> => {
        await Promise.resolve();
        console.log("slow done");
      },
    }),
  },
};

// The async `slow` command needs runAsync; everything else runs sync. The
// entry picks the path by argv[1] so both get ELF-smoked in one binary.
let useAsync = false;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "slow") {
    useAsync = true;
  }
}
if (useAsync) {
  runAsync(prog).then((c) => {
    process.exit(c);
  });
} else {
  process.exit(run(prog));
}
