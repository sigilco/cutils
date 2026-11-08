// @cutils/cli — type-first, declarative CLI builder in the scriptc
// compilable subset. The command spec is a plain record literal; a mapped
// type carries the options literal into the handler's `opts` parameter, so
// parse + validate + help all come from one static schema — no runtime
// reflection anywhere (reflection has no static lowering).
//
// Subset notes (see AGENTS.md for the full rulebook):
//   - No dynamic record READS (obj[key] is SC1090). All lookups walk
//     Object.entries() with indexed loops. Dynamic record WRITES (the
//     `values[name] = v` below) are fine.
//   - `| null` unions only; absent optional record members read as
//     `undefined` and are tested with `=== undefined` (the cache pattern).
//   - No classes, no `?.`/`??`, no spread, no shorthand methods.
//   - The handler crosses a dispatch boundary typed
//     `(opts: unknown, args: string[]) => void`; the precise `opts` shape
//     lives only in the user-facing command() generic.
//   - The Standard Schema seam is a structural StandardValidator interface,
//     NOT the official StandardSchemaV1 type — its computed "~standard" key
//     poisons Object.entries lowering. Users pass `schema["~standard"]`.

// ---------------------------------------------------------------- public types

// Structural Standard-Schema seam. `issues` absent/null = success.
export interface ValidationIssue {
  message: string;
}

export interface StandardResult {
  value?: unknown;
  issues?: ValidationIssue[] | null;
}

export interface StandardValidator {
  validate(value: unknown): StandardResult | Promise<StandardResult>;
}

export type OptionType = "boolean" | "string" | "number";

// User-facing per-option spec. `default` is `unknown` at the type level
// (multi-type unions in record members are subset-fragile); command()
// checks at construction that a provided default matches `type`.
export interface OptionSpec {
  type: OptionType;
  short?: string; // single character; "" / omitted = no short flag
  default?: unknown; // must match `type`; checked in command()
  description?: string;
  schema?: StandardValidator; // validates the parsed option value
}

// Mapped type: the options literal drives the handler's `opts` shape.
// Every declared key is present at runtime — boolean defaults to false,
// number to 0, string to "" — so `opts` members are never optional.
export type OptsFromOptions<O> = {
  [K in keyof O]: O[K] extends { type: "boolean" }
    ? boolean
    : O[K] extends { type: "number" }
      ? number
      : O[K] extends { type: "string" }
        ? string
        : unknown;
};

export interface CommandSpec<O extends Record<string, OptionSpec>> {
  args?: string[]; // required positional argument names, in order
  options?: O;
  schema?: StandardValidator; // validates { opts, args } before the handler
  handler: (opts: OptsFromOptions<O>, args: string[]) => void;
}

// Normalized internal option shape: concrete fields, no optional members,
// so the parse loop never branches on member presence.
export interface OptionDef {
  type: string; // "boolean" | "string" | "number"
  short: string; // "" = none
  hasDefault: boolean;
  defaultValue: unknown;
  description: string; // "" = none
  schema: StandardValidator | null;
}

export interface CommandDef {
  description: string;
  args: string[];
  options: Record<string, OptionDef>;
  schema: StandardValidator | null;
  handler: (opts: unknown, args: string[]) => void;
}

export interface ProgramSpec {
  name: string;
  version?: string;
  description?: string;
  commands: Record<string, CommandDef>;
}

// What a command-level schema receives.
export interface ParsedInput {
  opts: Record<string, unknown>;
  args: string[];
}

// ---------------------------------------------------------------- command()

export function command<O extends Record<string, OptionSpec>>(
  description: string,
  spec: CommandSpec<O>,
): CommandDef {
  const options: Record<string, OptionDef> = {};
  const specOpts: Record<string, OptionSpec> =
    spec.options === undefined ? {} : (spec.options as Record<string, OptionSpec>);
  const entries = Object.entries(specOpts);
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i][0];
    const s = entries[i][1];
    const hasDefault = s.default !== undefined;
    const def: OptionDef = {
      type: s.type,
      short: s.short === undefined ? "" : s.short,
      hasDefault: hasDefault,
      defaultValue: hasDefault ? s.default : "",
      description: s.description === undefined ? "" : s.description,
      schema: s.schema === undefined ? null : s.schema,
    };
    if (def.short.length > 1) {
      throw new Error("E_BAD_OPTION: --" + name + " short must be a single character");
    }
    if (def.hasDefault) {
      const dv = def.defaultValue;
      const ok =
        (def.type === "boolean" && typeof dv === "boolean") ||
        (def.type === "string" && typeof dv === "string") ||
        (def.type === "number" && typeof dv === "number");
      if (!ok) {
        throw new Error("E_BAD_OPTION: default for --" + name + " does not match type " + def.type);
      }
    }
    options[name] = def;
  }
  // Upcast the user handler to the dispatch boundary type. A plain
  // `const h = spec.handler` would hold a value declared with the generic
  // OptsFromOptions<O> type — scriptc keeps those as checked-dynamic slots.
  const h = spec.handler as (opts: unknown, args: string[]) => void;
  return {
    description: description,
    args: spec.args === undefined ? [] : spec.args,
    options: options,
    schema: spec.schema === undefined ? null : spec.schema,
    handler: h,
  };
}

// ---------------------------------------------------------------- run()

// Returns the process exit code; prints help to stdout and errors to
// stderr. Typical entry point: `process.exit(run({...}))` — run() itself
// never exits, so it stays unit-testable under plain Node.
export function run(prog: ProgramSpec, argv?: string[]): number {
  const args = argv === undefined ? process.argv.slice(2) : argv;
  if (args.length === 0) {
    printProgramHelp(prog);
    return 0;
  }
  const first = args[0];
  if (first === "--help" || first === "-h") {
    printProgramHelp(prog);
    return 0;
  }
  if (first === "--version") {
    if (prog.version === undefined) {
      console.log(prog.name);
    } else {
      console.log(prog.name + " " + prog.version);
    }
    return 0;
  }
  if (first.charAt(0) === "-") {
    return fail("unknown option '" + first + "' — run '" + prog.name + " --help'");
  }
  const cmds = Object.entries(prog.commands);
  let cmd: CommandDef | null = null;
  for (let i = 0; i < cmds.length; i++) {
    if (cmds[i][0] === first) {
      cmd = cmds[i][1];
      break;
    }
  }
  if (cmd === null) {
    const names: string[] = [];
    for (let i = 0; i < cmds.length; i++) {
      names.push(cmds[i][0]);
    }
    const sug = suggest(first, names);
    if (sug === "") {
      return fail("unknown command '" + first + "'");
    }
    return fail("unknown command '" + first + "' — did you mean '" + sug + "'?");
  }
  return runCommand(prog, first, cmd, args.slice(1));
}

// ---------------------------------------------------------------- parsing

function fail(msg: string): number {
  console.error("error: " + msg);
  return 1;
}

function runCommand(prog: ProgramSpec, cmdName: string, cmd: CommandDef, args: string[]): number {
  const optionEntries = Object.entries(cmd.options);
  const values: Record<string, unknown> = {};
  // Seed every declared key: explicit default, else the type's zero value.
  for (let i = 0; i < optionEntries.length; i++) {
    const name = optionEntries[i][0];
    const def = optionEntries[i][1];
    if (def.hasDefault) {
      values[name] = def.defaultValue;
    } else if (def.type === "boolean") {
      values[name] = false;
    } else if (def.type === "number") {
      values[name] = 0;
    } else {
      values[name] = "";
    }
  }

  const positionals: string[] = [];
  let endOpts = false;
  let i = 0;
  while (i < args.length) {
    const tok = args[i];
    if (endOpts) {
      positionals.push(tok);
      i = i + 1;
      continue;
    }
    if (tok === "--") {
      endOpts = true;
      i = i + 1;
      continue;
    }
    if (tok === "--help") {
      printCommandHelp(prog, cmdName, cmd);
      return 0;
    }
    if (tok.length > 2 && tok.substring(0, 2) === "--") {
      // --name or --name=value
      let body = tok.substring(2);
      let attached = "";
      let hasAttached = false;
      const eq = body.indexOf("=");
      if (eq >= 0) {
        attached = body.substring(eq + 1);
        body = body.substring(0, eq);
        hasAttached = true;
      }
      const k = findLong(optionEntries, body);
      if (k < 0) {
        return fail("unknown option '--" + body + "'");
      }
      const def = optionEntries[k][1];
      if (def.type === "boolean") {
        if (!hasAttached) {
          values[body] = true;
        } else if (attached === "true" || attached === "1") {
          values[body] = true;
        } else if (attached === "false" || attached === "0") {
          values[body] = false;
        } else {
          return fail("--" + body + ": expected a boolean, got '" + attached + "'");
        }
      } else {
        let raw = "";
        if (hasAttached) {
          raw = attached;
        } else {
          if (i + 1 >= args.length) {
            return fail("--" + body + " requires a value");
          }
          i = i + 1;
          raw = args[i];
        }
        const err = setValue(values, def, body, raw, "--" + body);
        if (err !== "") {
          return fail(err);
        }
      }
      i = i + 1;
      continue;
    }
    if (tok.length > 1 && tok.charAt(0) === "-") {
      // Short cluster: -u, -t 3, -t3, -ut3 (boolean shorts may cluster;
      // a value-taking short consumes the rest of the token or next arg).
      let j = 1;
      while (j < tok.length) {
        const c = tok.charAt(j);
        const k = findShort(optionEntries, c);
        if (k < 0) {
          if (c === "h" && j === 1 && tok.length === 2) {
            printCommandHelp(prog, cmdName, cmd);
            return 0;
          }
          return fail("unknown option '-" + c + "'");
        }
        const name = optionEntries[k][0];
        const def = optionEntries[k][1];
        if (def.type === "boolean") {
          values[name] = true;
          j = j + 1;
          continue;
        }
        let raw = "";
        if (j + 1 < tok.length) {
          raw = tok.substring(j + 1);
          if (raw.charAt(0) === "=") {
            raw = raw.substring(1);
          }
        } else {
          if (i + 1 >= args.length) {
            return fail("-" + c + " requires a value");
          }
          i = i + 1;
          raw = args[i];
        }
        const err = setValue(values, def, name, raw, "-" + c);
        if (err !== "") {
          return fail(err);
        }
        j = tok.length;
      }
      i = i + 1;
      continue;
    }
    positionals.push(tok);
    i = i + 1;
  }

  const required = cmd.args.length;
  if (positionals.length < required) {
    return fail("missing required argument '" + cmd.args[positionals.length] + "'");
  }
  if (positionals.length > required) {
    return fail("unexpected argument '" + positionals[required] + "'");
  }

  // Standard-Schema seam: per-option validators, then the command-level
  // validator over { opts, args }. Async validators are rejected cleanly —
  // instanceof Promise narrowing lowers fine.
  for (let e = 0; e < optionEntries.length; e++) {
    const name = optionEntries[e][0];
    const def = optionEntries[e][1];
    if (def.schema !== null) {
      const err = runValidator(def.schema, valueOf(values, name), "--" + name);
      if (err !== "") {
        return fail(err);
      }
    }
  }
  if (cmd.schema !== null) {
    const input: ParsedInput = { opts: values, args: positionals };
    const err = runValidator(cmd.schema, input, cmdName);
    if (err !== "") {
      return fail(err);
    }
  }

  cmd.handler(values, positionals);
  return 0;
}

// values[name] would be a dynamic record read (SC1090); walk entries.
function valueOf(rec: Record<string, unknown>, key: string): unknown {
  const entries = Object.entries(rec);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][0] === key) {
      return entries[i][1];
    }
  }
  return null;
}

function findLong(entries: [string, OptionDef][], name: string): number {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][0] === name) {
      return i;
    }
  }
  return -1;
}

function findShort(entries: [string, OptionDef][], c: string): number {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].short === c) {
      return i;
    }
  }
  return -1;
}

function setValue(
  values: Record<string, unknown>,
  def: OptionDef,
  name: string,
  raw: string,
  label: string,
): string {
  if (def.type === "number") {
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) {
      return label + ": expected a number, got '" + raw + "'";
    }
    values[name] = n;
    return "";
  }
  if (def.type === "string") {
    values[name] = raw;
    return "";
  }
  return label + ": boolean option '" + name + "' takes no value";
}

function runValidator(v: StandardValidator, value: unknown, label: string): string {
  const r = v.validate(value);
  if (r instanceof Promise) {
    return label + ": async validators are not supported (schema returned a Promise)";
  }
  const issues = r.issues;
  if (issues === undefined || issues === null || issues.length === 0) {
    return "";
  }
  let msg = label + ": validation failed";
  for (let i = 0; i < issues.length; i++) {
    msg = msg + "; " + issues[i].message;
  }
  return msg;
}

// ---------------------------------------------------------------- help

function pad(s: string, w: number): string {
  let out = s;
  while (out.length < w) {
    out = out + " ";
  }
  return out;
}

function printProgramHelp(prog: ProgramSpec): void {
  let head = prog.name;
  if (prog.version !== undefined) {
    head = head + " " + prog.version;
  }
  if (prog.description !== undefined && prog.description !== "") {
    head = head + " — " + prog.description;
  }
  console.log(head);
  console.log("");
  console.log("Usage: " + prog.name + " <command> [options]");
  const cmds = Object.entries(prog.commands);
  if (cmds.length > 0) {
    console.log("");
    console.log("Commands:");
    let w = 0;
    for (let i = 0; i < cmds.length; i++) {
      if (cmds[i][0].length > w) {
        w = cmds[i][0].length;
      }
    }
    for (let i = 0; i < cmds.length; i++) {
      console.log("  " + pad(cmds[i][0], w) + "  " + cmds[i][1].description);
    }
  }
  console.log("");
  console.log("Options:");
  console.log("  -h, --help     show help");
  console.log("  --version      show version");
}

function printCommandHelp(prog: ProgramSpec, cmdName: string, cmd: CommandDef): void {
  console.log(prog.name + " " + cmdName + " — " + cmd.description);
  console.log("");
  const optionEntries = Object.entries(cmd.options);
  let usage = "Usage: " + prog.name + " " + cmdName;
  for (let i = 0; i < cmd.args.length; i++) {
    usage = usage + " <" + cmd.args[i] + ">";
  }
  if (optionEntries.length > 0) {
    usage = usage + " [options]";
  }
  console.log(usage);
  if (cmd.args.length > 0) {
    console.log("");
    console.log("Arguments:");
    for (let i = 0; i < cmd.args.length; i++) {
      console.log("  <" + cmd.args[i] + ">");
    }
  }
  console.log("");
  console.log("Options:");
  // Build [label, description] rows, then pad labels to the widest.
  const labels: string[] = [];
  const descs: string[] = [];
  for (let i = 0; i < optionEntries.length; i++) {
    const name = optionEntries[i][0];
    const def = optionEntries[i][1];
    let label = "";
    if (def.short !== "") {
      label = "-" + def.short + ", --" + name;
    } else {
      label = "    --" + name;
    }
    if (def.type === "number") {
      label = label + " <n>";
    } else if (def.type === "string") {
      label = label + " <str>";
    }
    let desc = def.description;
    if (def.hasDefault) {
      desc = desc + " (default: " + String(def.defaultValue) + ")";
    }
    labels.push(label);
    descs.push(desc);
  }
  labels.push("-h, --help");
  descs.push("show help");
  let w = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].length > w) {
      w = labels[i].length;
    }
  }
  for (let i = 0; i < labels.length; i++) {
    console.log("  " + pad(labels[i], w) + "  " + descs[i]);
  }
}

// ---------------------------------------------------------------- suggestions

function suggest(input: string, names: string[]): string {
  let best = "";
  let bestDist = 3; // only distances <= 2 or a prefix match qualify
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const prefix = n.substring(0, input.length) === input || input.substring(0, n.length) === n;
    const d = editDistance(input, n);
    if ((d <= 2 || prefix) && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  let prev: number[] = [];
  for (let j = 0; j <= n; j++) {
    prev.push(j);
  }
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      let min = del;
      if (ins < min) {
        min = ins;
      }
      if (sub < min) {
        min = sub;
      }
      cur.push(min);
    }
    prev = cur;
  }
  return prev[n];
}
