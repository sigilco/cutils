// ELF smoke app for @cutils/cli — compiled with `scriptc build` by
// test/elf.test.sh. A two-command demo CLI: `greet` exercises boolean/
// number/string options + short flags + a schema; `add` exercises two
// positionals. test/elf.test.sh drives the full validation matrix.

import { command, run } from "../src/index.ts";

const prog = {
  name: "demo",
  version: "1.0.0",
  description: "elf smoke demo",
  commands: {
    greet: command("greet someone", {
      args: ["name"],
      options: {
        upper: { type: "boolean", short: "u", description: "uppercase output" },
        times: {
          type: "number",
          short: "t",
          default: 1,
          description: "repeat n times",
          schema: {
            validate: (value: unknown) => {
              if (typeof value === "number" && value > 10) {
                return { issues: [{ message: "times must be <= 10" }] };
              }
              return { value: value };
            },
          },
        },
        greeting: { type: "string", short: "g", description: "greeting word" },
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
