// Full-surface @cutils/cli app — subcommand tree, variadic positional,
// variadic + optionalValue + negatable + env + camelCase options, async
// handler via runAsync. The size delta vs cli-basic.ts shows what each
// v1 feature costs in the compiled ELF (unreachable-code elimination
// should drop what the spec doesn't reference — measure, don't assume).

import { bool, command, int, run, runAsync, str } from "../../packages/cli/src/index.ts";

const prog = {
  name: "full",
  version: "1.0.0",
  options: { verbose: bool({ short: "v" }) },
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: bool({ short: "u" }),
        times: int({ short: "t", default: 1 }),
        greeting: str({ short: "g" }),
      },
      handler: (opts, args) => {
        console.log(opts.greeting + " " + args[0]);
      },
    }),
    tags: command("tag files", {
      args: [{ name: "files", variadic: true }],
      options: {
        tag: { variadic: true },
        "dry-run": bool({ short: "n" }),
      },
      handler: (opts, args) => {
        console.log(String(opts.tag.length) + " tags " + String(args[0].length) + " files");
      },
    }),
    opt: command("optional value", {
      args: [{ name: "out", optional: true }],
      options: {
        color: { optionalValue: true },
        cache: { flag: true, negatable: true, default: true },
        target: str({ env: "DEPLOY_TARGET" }),
      },
      handler: (opts) => {
        console.log(String(opts.color) + " " + String(opts.cache) + " " + String(opts.target));
      },
    }),
    deploy: command("deploy things", {
      commands: {
        web: command("deploy web", { handler: () => console.log("web") }),
        api: command("deploy api", {
          alias: "a",
          handler: () => console.log("api"),
        }),
      },
    }),
    slow: command("async handler", {
      handler: async () => {
        await Promise.resolve();
        console.log("slow done");
      },
    }),
  },
};

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
