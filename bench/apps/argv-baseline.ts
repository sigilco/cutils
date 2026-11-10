// argv-only baseline: hand-rolled parse with zero library code. This is
// the "no library" control for binary-size overhead measurements — the
// delta between this ELF and cli-*.ts ELFs is the library's footprint.

const args = process.argv.slice(2);
const values: Record<string, unknown> = { upper: false, times: "1", greeting: "" };
const positionals: string[] = [];

let i = 0;
while (i < args.length) {
  const tok = args[i];
  if (tok === "--upper" || tok === "-u") {
    values.upper = true;
  } else if (tok === "--times" || tok === "-t") {
    i = i + 1;
    values.times = i < args.length ? args[i] : "";
  } else if (tok.substring(0, 8) === "--times=") {
    values.times = tok.substring(8);
  } else if (tok === "--greeting" || tok === "-g") {
    i = i + 1;
    values.greeting = i < args.length ? args[i] : "";
  } else if (tok === "greet") {
    // dispatch token — skip
  } else if (tok.charAt(0) !== "-") {
    positionals.push(tok);
  }
  i = i + 1;
}

let who = positionals.length > 0 ? positionals[0] : "world";
let word = values.greeting as string;
if (word === "") {
  word = "hello";
}
if (values.upper === true) {
  who = who.toUpperCase();
  word = word.toUpperCase();
}
const n = Number(values.times);
for (let k = 0; k < n; k++) {
  console.log(word + " " + who);
}
