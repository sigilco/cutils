// Minimal @cutils/cli app — one command, three options, one positional.
// The binary-size delta vs argv-baseline.ts is the v1 library footprint
// for the simplest realistic CLI.

import { bool, command, int, run, str } from "../../packages/cli/src/index.ts";

const prog = {
  name: "basic",
  version: "1.0.0",
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: bool({ short: "u" }),
        times: int({ short: "t", default: 1 }),
        greeting: str({ short: "g" }),
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
  },
};

process.exit(run(prog));
