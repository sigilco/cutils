// ELF smoke app for @cutils/cli — compiled with `scriptc build` by
// test/elf.test.sh. A two-command demo CLI: `greet` exercises the bool/
// num/str builtins (flag, bounded number, raw string) + short flags;
// `add` exercises two positionals. test/elf.test.sh drives the full
// validation matrix.

import { bool, command, int, run, str } from "../src/index.ts";

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
  },
};

process.exit(run(prog));
