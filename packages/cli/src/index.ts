// @cutils/cli — declarative CLI builder in the scriptc compilable subset.
// Single-responsibility: argv tokenize → flag-vs-value → effective value →
// the Standard Schema `validate` boundary → {opts, args} → dispatch. All
// value semantics (coercion, constraints, literal unions, morphs) belong to
// the schema — we transport raw argv strings, validators interpret them.
// `opts` typing derives entirely from Standard Schema's `types.output`
// phantom channel; no schema → the option is a string (the argv truth).
//
// Subset notes (see AGENTS.md for the full rulebook):
//   - No dynamic record READS (obj[key] is SC1090). All lookups walk
//     Object.entries() with indexed loops. Dynamic record WRITES (the
//     `values[name] = v` below) are fine.
//   - `| null` unions only; absent optional record members read as
//     `undefined` and are tested with `=== undefined`.
//   - No classes, no `?.`/`??`, no spread, no shorthand methods.
//   - The handler crosses a dispatch boundary typed
//     `(opts: unknown, args: string[]) => void`; the precise `opts` shape
//     lives only in the user-facing command() generic.
//   - The Standard Schema seam accepts a bare validator, the "~standard"
//     props object, a whole schema object (arktype Type, zod schema), or a
//     bare `(v) => result` function; command() unwraps to the callable
//     validator. OptsFromOptions reads `types.output` so schema libraries
//     drive `opts` inference through the spec's own type channel.

// ---------------------------------------------------------------- public types

// Structural Standard-Schema seam. `issues` absent/null = success.
export interface ValidationIssue {
  message: string;
}

export interface StandardResult {
  value?: unknown;
  issues?: readonly ValidationIssue[] | null;
}

// A bare validator object — the shape hand-rolled and foreign validators
// share. `types` is Standard Schema's phantom input/output channel: it is
// never read at runtime, but OptsFromOptions maps `output` into `opts`, so
// declaring it on a custom validator types the option with zero machinery.
export interface StandardValidator {
  validate(value: unknown): StandardResult | Promise<StandardResult>;
  types?: { input?: unknown; output?: unknown };
}

// The props object at schema["~standard"] — what Standard Schema consumers
// call.
export interface StandardValidatorProps {
  validate(value: unknown): StandardResult | Promise<StandardResult>;
  types?: { input?: unknown; output?: unknown };
}

// A bare `(v) => result` function — the minimal validation boundary. It has
// no type channel, so the option's `opts` member is `unknown`.
export type ValidateFn = (value: unknown) => StandardResult | Promise<StandardResult>;

// What OptionSpec.schema / CommandSpec.schema accept: a bare validator, the
// "~standard" props object, a whole schema object carrying one (an arktype
// Type, a zod schema), or a bare function. All members optional so every
// object shape fits; command() throws E_BAD_OPTION when no validate path
// exists.
export interface StandardSchemaInput {
  validate?(value: unknown): StandardResult | Promise<StandardResult>;
  "~standard"?: StandardValidatorProps;
  types?: { input?: unknown; output?: unknown };
}

export type SchemaInput = StandardSchemaInput | ValidateFn;

// User-facing per-option spec. There is no `type` field: flag-vs-value is
// the only parse fact the library needs (`flag`), and everything else —
// coercion, constraints, the `opts` type — comes from the schema.
export interface OptionSpec {
  schema?: SchemaInput; // absent = raw string passthrough (the argv truth)
  flag?: boolean; // true = consumes no value; --x / --x=false / -x
  short?: string; // single character; "" / omitted = no short flag
  default?: unknown; // the value opts receives when absent; run through validate() in command()
  description?: string;
  metavar?: string; // help hint shown as `--name <metavar>`; defaults to the option name
}

// One options-record member: a spec, a whole schema object, or a bare
// validate function. command() discriminates: "~standard" or "validate"
// present (or the entry is a function) → schema; otherwise OptionSpec.
export type OptionInput = OptionSpec | StandardSchemaInput | ValidateFn;

// A validator whose declared output type is visible to OptsFromOptions —
// the shape the builtins return. `types` stays phantom; only the declared
// type is annotated, no runtime `types` member is emitted. `output` is a
// REQUIRED member of the phantom (matching the Standard Schema spec) —
// SchemaOutput's `{output: infer O}` pattern never matches an optional one.
export interface TypedValidator<O> {
  validate(value: unknown): StandardResult;
  types?: { input?: unknown; output: O };
}

// Shared extras every builtin factory accepts and merges.
export interface BuiltinOpts {
  short?: string;
  default?: unknown;
  description?: string;
  metavar?: string;
}

export interface NumOpts extends BuiltinOpts {
  min?: number; // inclusive lower bound
  max?: number; // inclusive upper bound
}

// Sentinel for "the schema declares no output type" — an object shape no
// real schema output type is assignable to.
export interface NoSchemaOutput {
  readonly "~cli/noSchemaOutput": true;
}

// The output type a schema declares through Standard Schema's `types`
// channel. Checks the whole-schema form first ("~standard".types.output),
// then the props/bare-validator form (types.output directly), then gives up.
export type SchemaOutput<S> = S extends { "~standard": { types?: infer T } }
  ? NonNullable<T> extends { output: infer O }
    ? O
    : NoSchemaOutput
  : S extends { types?: infer T }
    ? NonNullable<T> extends { output: infer O }
      ? O
      : NoSchemaOutput
    : NoSchemaOutput;

type FlagOrString<O> = O extends { flag: true } ? boolean : string;

// Mapped type: the options literal drives the handler's `opts` shape, and
// the Standard Schema `types.output` channel is the ONLY type source:
//   bare schema entry      → its declared output
//   { schema: S }          → S's declared output; no output → unknown
//   { flag: true } (bare)  → boolean
//   everything else        → string — absent a schema, argv IS strings
// Every declared key is present at runtime — absent options take the
// default, else flag → false, else "" — so members are never optional.
export type OptsFromOptions<O extends Record<string, OptionInput>> = {
  [K in keyof O]: O[K] extends { "~standard": unknown }
    ? SchemaOutput<O[K]>
    : O[K] extends { validate: unknown }
      ? SchemaOutput<O[K]>
      : O[K] extends ValidateFn
        ? unknown
        : O[K] extends { schema?: infer S }
          ? [NonNullable<S>] extends [never]
            ? FlagOrString<O[K]>
            : SchemaOutput<NonNullable<S>> extends infer T
              ? [T] extends [NoSchemaOutput]
                ? unknown
                : [unknown] extends [T]
                  ? unknown
                  : T
              : unknown
          : FlagOrString<O[K]>;
};

export interface CommandSpec<O extends Record<string, OptionInput>> {
  args?: string[]; // required positional argument names, in order
  options?: O;
  schema?: SchemaInput; // validates { opts, args } before the handler
  handler: (opts: OptsFromOptions<O>, args: string[]) => void;
}

// Normalized internal option shape: concrete fields, no optional members,
// so the parse loop never branches on member presence.
export interface OptionDef {
  flag: boolean; // consumes no value
  short: string; // "" = none
  hasDefault: boolean;
  defaultValue: unknown;
  description: string; // "" = none
  metavar: string; // "" = fall back to the option name in help
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

// ---------------------------------------------------------------- builtins

// Zero-dependency primitives as Standard-Schema-shaped validators. Each
// factory returns an OptionSpec carrying a TypedValidator, so `opts`
// inference works without any schema library installed. Extra OptionSpec
// fields in `extra` (and metavar overrides) merge over the defaults.

export function str(extra?: BuiltinOpts): OptionSpec & { schema: TypedValidator<string> } {
  const v: TypedValidator<string> = {
    validate: (value: unknown): StandardResult => {
      if (typeof value === "string") {
        return { value: value };
      }
      return { issues: [{ message: "expected a string" }] };
    },
  };
  const spec: OptionSpec = { schema: v, metavar: "str" };
  return mergeExtra(spec, extra) as OptionSpec & { schema: TypedValidator<string> };
}

export function num(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> } {
  const lo = extra !== undefined && extra.min !== undefined ? extra.min : null;
  const hi = extra !== undefined && extra.max !== undefined ? extra.max : null;
  const v: TypedValidator<number> = {
    validate: (value: unknown): StandardResult => {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) {
        return { issues: [{ message: "expected a number, got '" + String(value) + "'" }] };
      }
      if (lo !== null && n < lo) {
        return {
          issues: [{ message: "expected a number >= " + String(lo) + ", got " + String(n) }],
        };
      }
      if (hi !== null && n > hi) {
        return {
          issues: [{ message: "expected a number <= " + String(hi) + ", got " + String(n) }],
        };
      }
      return { value: n };
    },
  };
  const spec: OptionSpec = { schema: v, metavar: "n" };
  return mergeExtra(spec, extra) as OptionSpec & { schema: TypedValidator<number> };
}

export function int(extra?: NumOpts): OptionSpec & { schema: TypedValidator<number> } {
  const lo = extra !== undefined && extra.min !== undefined ? extra.min : null;
  const hi = extra !== undefined && extra.max !== undefined ? extra.max : null;
  const v: TypedValidator<number> = {
    validate: (value: unknown): StandardResult => {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) {
        return { issues: [{ message: "expected a number, got '" + String(value) + "'" }] };
      }
      if (!Number.isInteger(n)) {
        return { issues: [{ message: "expected an integer, got " + String(n) }] };
      }
      if (lo !== null && n < lo) {
        return {
          issues: [{ message: "expected an integer >= " + String(lo) + ", got " + String(n) }],
        };
      }
      if (hi !== null && n > hi) {
        return {
          issues: [{ message: "expected an integer <= " + String(hi) + ", got " + String(n) }],
        };
      }
      return { value: n };
    },
  };
  const spec: OptionSpec = { schema: v, metavar: "int" };
  return mergeExtra(spec, extra) as OptionSpec & { schema: TypedValidator<number> };
}

export function bool(
  extra?: BuiltinOpts,
): OptionSpec & { flag: true; schema: TypedValidator<boolean> } {
  const v: TypedValidator<boolean> = {
    validate: (value: unknown): StandardResult => {
      if (value === true || value === "true" || value === "1") {
        return { value: true };
      }
      if (value === false || value === "false" || value === "0") {
        return { value: false };
      }
      return { issues: [{ message: "expected a boolean, got '" + String(value) + "'" }] };
    },
  };
  const spec: OptionSpec = { flag: true, schema: v };
  return mergeExtra(spec, extra) as OptionSpec & { flag: true; schema: TypedValidator<boolean> };
}

function mergeExtra(spec: OptionSpec, extra?: BuiltinOpts): OptionSpec {
  const out: OptionSpec = {};
  if (spec.schema !== undefined) {
    out.schema = spec.schema;
  }
  if (spec.flag !== undefined) {
    out.flag = spec.flag;
  }
  if (spec.metavar !== undefined) {
    out.metavar = spec.metavar;
  }
  if (extra === undefined) {
    return out;
  }
  if (extra.short !== undefined) {
    out.short = extra.short;
  }
  if (extra.default !== undefined) {
    out.default = extra.default;
  }
  if (extra.description !== undefined) {
    out.description = extra.description;
  }
  if (extra.metavar !== undefined) {
    out.metavar = extra.metavar;
  }
  return out;
}

// ---------------------------------------------------------------- command()

export function command<O extends Record<string, OptionInput>>(
  description: string,
  spec: CommandSpec<O>,
): CommandDef {
  const options: Record<string, OptionDef> = {};
  const specOpts: Record<string, OptionInput> =
    spec.options === undefined ? {} : (spec.options as Record<string, OptionInput>);
  const entries = Object.entries(specOpts);
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i][0];
    const raw = entries[i][1];
    // Discriminate: a "~standard" or "validate" member (or a bare function)
    // means the entry IS a schema; otherwise it is an OptionSpec literal.
    let flag = false;
    let short = "";
    let desc = "";
    let metavar = "";
    let hasDefault = false;
    let defaultValue: unknown = "";
    let schemaInput: SchemaInput | undefined;
    if (isSchemaValue(raw)) {
      schemaInput = raw as SchemaInput;
    } else {
      const sp = raw as OptionSpec;
      flag = sp.flag === true;
      short = sp.short === undefined ? "" : sp.short;
      desc = sp.description === undefined ? "" : sp.description;
      metavar = sp.metavar === undefined ? "" : sp.metavar;
      if (sp.schema !== undefined) {
        schemaInput = sp.schema;
      }
      if (sp.default !== undefined) {
        hasDefault = true;
        defaultValue = sp.default;
      }
    }
    const def: OptionDef = {
      flag: flag,
      short: short,
      hasDefault: hasDefault,
      defaultValue: defaultValue,
      description: desc,
      metavar: metavar,
      schema: normalizeSchema(schemaInput, "--" + name),
    };
    if (def.short.length > 1) {
      throw new Error("E_BAD_OPTION: --" + name + " short must be a single character");
    }
    if (def.hasDefault) {
      // The default goes through the schema: issues → E_BAD_OPTION with the
      // validator's own message; a morph output becomes the stored default.
      if (def.schema !== null) {
        const oc = validateValue(def.schema, def.defaultValue, "--" + name);
        if (oc.error !== "") {
          throw new Error("E_BAD_OPTION: " + oc.error);
        }
        if (oc.hasOut) {
          def.defaultValue = oc.out;
        }
      } else {
        const ok = def.flag
          ? typeof def.defaultValue === "boolean"
          : typeof def.defaultValue === "string";
        if (!ok) {
          throw new Error(
            "E_BAD_OPTION: default for --" +
              name +
              (def.flag
                ? " must be a boolean"
                : " must be a string (declare a schema for other types)"),
          );
        }
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
    schema: normalizeSchema(spec.schema, "command"),
    handler: h,
  };
}

// An options entry is a schema when it carries "~standard" or "validate",
// or when it is a bare function. OptionSpec never has those members, so the
// discriminator cannot collide (a zod schema's `.description` is never
// reached — "~standard" wins).
function isSchemaValue(v: unknown): boolean {
  if (typeof v === "function") {
    return true;
  }
  const s = v as StandardSchemaInput;
  return s["~standard"] !== undefined || s.validate !== undefined;
}

// Unwrap a SchemaInput to the callable validator: a bare function first,
// then the "~standard" props (the spec's consumption path — an arktype Type
// or zod schema carries no top-level validate), then a bare validator.
// Throws at construction when no validate path exists so a schema-less
// "schema" can never silently pass.
function normalizeSchema(input: SchemaInput | undefined, label: string): StandardValidator | null {
  if (input === undefined) {
    return null;
  }
  if (typeof input === "function") {
    return { validate: input };
  }
  const std = input["~standard"];
  if (std !== undefined && std.validate !== undefined) {
    return std;
  }
  if (input.validate !== undefined) {
    return input as StandardValidator;
  }
  throw new Error("E_BAD_OPTION: " + label + " schema has neither ~standard.validate nor validate");
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
  // Seed every declared key: validated default, else the zero value —
  // false for flags, "" for value-options (a schema may then coerce it).
  for (let i = 0; i < optionEntries.length; i++) {
    const name = optionEntries[i][0];
    const def = optionEntries[i][1];
    if (def.hasDefault) {
      values[name] = def.defaultValue;
    } else if (def.flag) {
      values[name] = false;
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
      // --name or --name=value. Attached values stay strings — the
      // validator owns interpretation, including "false"/"0" on flags.
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
      if (def.flag) {
        if (!hasAttached) {
          values[body] = true;
        } else {
          values[body] = attached;
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
        values[body] = raw;
      }
      i = i + 1;
      continue;
    }
    if (tok.length > 1 && tok.charAt(0) === "-") {
      // Short cluster: -u, -t 3, -t3, -ut3 (flag shorts may cluster; a
      // value-taking short consumes the rest of the token or next arg).
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
        if (def.flag) {
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
        values[name] = raw;
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

  // The schema boundary: every option's effective value (explicit, default,
  // or zero) passes its validator and the OUTPUT is stored — morphs apply.
  // Schema-less flags coerce "true"/"1"/"false"/"0" attached forms here.
  // Async validators are rejected cleanly — instanceof Promise lowers fine.
  for (let e = 0; e < optionEntries.length; e++) {
    const name = optionEntries[e][0];
    const def = optionEntries[e][1];
    const v = valueOf(values, name);
    if (def.schema !== null) {
      const oc = validateValue(def.schema, v, "--" + name);
      if (oc.error !== "") {
        return fail(oc.error);
      }
      if (oc.hasOut) {
        values[name] = oc.out;
      }
    } else if (def.flag && typeof v === "string") {
      if (v === "true" || v === "1") {
        values[name] = true;
      } else if (v === "false" || v === "0") {
        values[name] = false;
      } else {
        return fail("--" + name + ": expected a boolean, got '" + v + "'");
      }
    }
  }
  if (cmd.schema !== null) {
    const input: ParsedInput = { opts: values, args: positionals };
    const oc = validateValue(cmd.schema, input, cmdName);
    if (oc.error !== "") {
      return fail(oc.error);
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

interface ValidateOutcome {
  error: string; // "" = success
  hasOut: boolean; // the validator returned a (possibly morphed) value
  out: unknown;
}

// Run one validator and normalize the result: issues join into one error
// string (validator-owned messages), a success `value` becomes `out` so
// callers can store morphed output. A Promise result is a clean error.
function validateValue(v: StandardValidator, value: unknown, label: string): ValidateOutcome {
  const r = v.validate(value);
  if (r instanceof Promise) {
    return {
      error: label + ": async validators are not supported (schema returned a Promise)",
      hasOut: false,
      out: null,
    };
  }
  const issues = r.issues;
  if (issues !== undefined && issues !== null && issues.length > 0) {
    let msg = label + ": ";
    for (let i = 0; i < issues.length; i++) {
      if (i > 0) {
        msg = msg + "; ";
      }
      msg = msg + (issues[i].message === "" ? "validation failed" : issues[i].message);
    }
    return { error: msg, hasOut: false, out: null };
  }
  if (r.value !== undefined) {
    return { error: "", hasOut: true, out: r.value };
  }
  return { error: "", hasOut: false, out: null };
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
    if (!def.flag) {
      label = label + " <" + (def.metavar !== "" ? def.metavar : name) + ">";
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
