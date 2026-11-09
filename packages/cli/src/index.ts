// @cutils/cli — declarative CLI builder in the scriptc compilable subset.
// Single-responsibility: argv tokenize → flag-vs-value → effective value →
// the Standard Schema `validate` boundary → {opts, args} → dispatch. All
// value semantics (coercion, constraints, literal unions, morphs) belong to
// the schema — we transport raw argv strings, validators interpret them.
// `opts` typing derives entirely from Standard Schema's `types.output`
// phantom channel; no schema → the option is a string (the argv truth).
//
// The program IS a command node: ProgramSpec carries the same
// args/options/schema/handler/commands fields as every CommandDef, so one
// descent loop (`runNode`/`runNodeAsync`) handles root, flat commands, and
// subcommand trees alike.
//
// Subset notes (see AGENTS.md for the full rulebook):
//   - No dynamic record READS (obj[key] is SC1090). All lookups walk
//     Object.entries() with indexed loops. Dynamic record WRITES (the
//     `values[name] = v` below) are fine. `process.env[name]` reads are
//     exempt — process.env is not a user record.
//   - `| null` unions only; absent optional record members read as
//     `undefined` and are tested with `=== undefined`.
//   - No classes, no `?.`/`??`, no spread, no shorthand methods.
//   - The handler crosses a dispatch boundary typed
//     `(opts: unknown, args: unknown[]) => unknown`; the precise shapes
//     live only in the user-facing command()/run() generics.
//   - `handler` returns `unknown`, not `void | Promise<void>` — the union
//     adds dynamic slots; unknown accepts both sync and async handlers and
//     lets the runtime discriminate via `instanceof Promise`.
//   - The Standard Schema seam accepts a bare validator, the "~standard"
//     props object, a whole schema object (arktype Type, zod schema), or a
//     bare `(v) => result` function; command() unwraps to the callable
//     validator. OptsFromOptions/ArgsFromSpec read `types.output` so schema
//     libraries drive inference through the spec's own type channel.

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
  optionalValue?: boolean; // --opt bare → true, --opt=v → "v" (no space-separated form)
  variadic?: boolean; // value-option: --tag a b c / --tag a --tag b → string[] per element through schema
  negatable?: boolean; // flag only: --no-name parses to false
  short?: string; // single character; "" / omitted = no short flag
  default?: unknown; // the value opts receives when absent; run through validate() in command()
  env?: string; // absent → process.env[env] when set (still goes through validate())
  description?: string;
  metavar?: string; // help hint shown as `--name <metavar>`; defaults to the option name
  hidden?: boolean; // omit from generated help
}

// One options-record member: a spec, a whole schema object, or a bare
// validate function. command() discriminates: "~standard" or "validate"
// present (or the entry is a function) → schema; otherwise OptionSpec.
export type OptionInput = OptionSpec | StandardSchemaInput | ValidateFn;

// User-facing per-positional-arg spec. A bare string is a required arg
// named by the string — the v0 form, unchanged.
export interface ArgSpec {
  name: string;
  optional?: boolean; // may be omitted; absent → default else null (never undefined)
  variadic?: boolean; // collects the rest of the positionals → array (must be last)
  default?: unknown; // absent-optional value; run through validate() in command()
  description?: string;
  schema?: SchemaInput; // validates each element (per element for variadic)
}

export type ArgInput = string | ArgSpec;

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
  env?: string;
  hidden?: boolean;
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

// Kebab → camel remap for `opts` keys (commander parity): declaring
// `"template-engine"` types `opts.templateEngine`.
export type CamelKey<S extends string> = S extends `${infer A}-${infer B}`
  ? `${A}${CamelKey<Capitalize<B>>}`
  : S;

type FlagOrString<O> = O extends { flag: true }
  ? boolean
  : O extends { variadic: true }
    ? string[]
    : O extends { optionalValue: true }
      ? string | boolean
      : string;

// Mapped type: the options literal drives the handler's `opts` shape, and
// the Standard Schema `types.output` channel is the ONLY type source:
//   bare schema entry      → its declared output
//   { schema: S }          → S's declared output; no output → unknown
//   { flag: true } (bare)  → boolean
//   { variadic: true }     → element output, arrayed
//   { optionalValue: true} → schema output, else string | boolean
//   everything else        → string — absent a schema, argv IS strings
// Every declared key is present at runtime — absent options take the
// default, else flag → false, else "" — so members are never optional.
// Keys remap through CamelKey (`"x-y"` → `xY`).
export type OptsFromOptions<O extends Record<string, OptionInput>> = {
  [K in keyof O as K extends string ? CamelKey<K> : K]: O[K] extends { "~standard": unknown }
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
                  : O[K] extends { variadic: true }
                    ? T[]
                    : T
              : unknown
          : FlagOrString<O[K]>;
};

// The output type of one positional arg entry: `{schema: S}` → S's output,
// a bare string name or schema-less ArgSpec → string.
type ArgOut<T> = T extends string
  ? string
  : T extends { schema: infer S }
    ? [NonNullable<S>] extends [never]
      ? string
      : SchemaOutput<NonNullable<S>> extends infer R
        ? [R] extends [NoSchemaOutput]
          ? unknown
          : R
        : unknown
    : string;

// Mapped tuple: `args` entries drive the handler's `args` tuple shape.
// optional → `Out | null` (absent optional is null, never undefined);
// required variadic → `Out, ...Out[]`; optional variadic → `...Out[]`.
// A non-tuple `args` annotation (e.g. a plain `string[]`) keeps the legacy
// `string[]` shape.
export type ArgsFromSpec<
  A extends readonly ArgInput[],
  Acc extends unknown[] = [],
> = number extends A["length"]
  ? Acc extends []
    ? string[]
    : Acc
  : A extends readonly [infer H, ...infer T]
    ? T extends readonly ArgInput[]
      ? H extends { variadic: true }
        ? [...Acc, ArgOut<H>[]]
        : H extends { optional: true }
          ? ArgsFromSpec<T, [...Acc, ArgOut<H> | null]>
          : ArgsFromSpec<T, [...Acc, ArgOut<H>]>
      : Acc
    : Acc;

export interface CommandSpec<
  O extends Record<string, OptionInput>,
  A extends readonly ArgInput[] = readonly ArgInput[],
> {
  args?: A; // positional argument specs, in order
  options?: O;
  schema?: SchemaInput; // validates { opts, args } before the handler
  handler?: (opts: OptsFromOptions<O>, args: ArgsFromSpec<A>) => unknown;
  commands?: Record<string, CommandDef>; // subcommand map — presence makes this a group node
  alias?: string | string[]; // alternate invocation names
  hidden?: boolean; // omit from parent help
}

// Normalized internal shapes: concrete fields, no optional members, so the
// parse loop never branches on member presence.
export interface ArgDef {
  name: string;
  optional: boolean;
  variadic: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  description: string;
  schema: StandardValidator | null;
}

export interface OptionDef {
  flag: boolean; // consumes no value
  optionalValue: boolean; // bare → true, =attached → string
  variadic: boolean; // value-option accumulating occurrences + followers
  negatable: boolean; // flag accepting --no-<name>
  short: string; // "" = none
  envName: string; // "" = none
  hidden: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  description: string; // "" = none
  metavar: string; // "" = fall back to the option name in help
  schema: StandardValidator | null;
  optsKey: string; // camelCase-normalized key into the opts record
}

export interface CommandDef {
  description: string;
  args: ArgDef[];
  options: Record<string, OptionDef>;
  commands: Record<string, CommandDef>; // non-empty ⇒ group node
  aliases: string[];
  hidden: boolean;
  schema: StandardValidator | null;
  handler: ((opts: unknown, args: unknown[]) => unknown) | null;
}

// The program is a root command node with name/version extras. All node
// fields are optional — a program can be pure dispatcher, a single-command
// CLI (args/options/handler, no commands), or both.
export interface ProgramSpec<
  O extends Record<string, OptionInput> = Record<string, OptionInput>,
  A extends readonly ArgInput[] = readonly ArgInput[],
> {
  name: string;
  version?: string;
  description?: string;
  args?: A;
  options?: O;
  schema?: SchemaInput;
  handler?: (opts: OptsFromOptions<O>, args: ArgsFromSpec<A>) => unknown;
  commands?: Record<string, CommandDef>;
}

// The non-generic slice of ProgramSpec the descent/help machinery
// needs — helpers take this so ProgramSpec<O,A> flows through unchecked.
export interface ProgramHead {
  name: string;
  version?: string;
  description?: string;
}

// What a command-level schema receives.
export interface ParsedInput {
  opts: Record<string, unknown>;
  args: unknown[];
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
  if (extra.env !== undefined) {
    out.env = extra.env;
  }
  if (extra.hidden !== undefined) {
    out.hidden = extra.hidden;
  }
  return out;
}

// ---------------------------------------------------------------- command()

export function command<
  O extends Record<string, OptionInput>,
  const A extends readonly ArgInput[] = readonly ArgInput[],
>(description: string, spec: CommandSpec<O, A>): CommandDef {
  const options = normalizeOptions(spec.options === undefined ? {} : spec.options);
  const defs = normalizeArgs(spec.args === undefined ? [] : spec.args);
  const cmds = spec.commands === undefined ? {} : spec.commands;
  const hasCommands = Object.entries(cmds).length > 0;
  // Upcast the user handler to the dispatch boundary type. A plain
  // `const h = spec.handler` would hold a value declared with the generic
  // OptsFromOptions<O> type — scriptc keeps those as checked-dynamic slots.
  const h =
    spec.handler === undefined
      ? null
      : (spec.handler as (opts: unknown, args: unknown[]) => unknown);
  if (!hasCommands && h === null) {
    throw new Error("E_BAD_OPTION: a leaf command requires a handler");
  }
  const aliases: string[] = [];
  if (spec.alias !== undefined) {
    if (typeof spec.alias === "string") {
      aliases.push(spec.alias);
    } else {
      for (let i = 0; i < spec.alias.length; i++) {
        aliases.push(spec.alias[i]);
      }
    }
  }
  return {
    description: description,
    args: defs,
    options: options,
    commands: cmds,
    aliases: aliases,
    hidden: spec.hidden === true,
    schema: normalizeSchema(spec.schema, "command"),
    handler: h,
  };
}

// Kebab → camel for the `opts` key (commander parity): "template-engine" →
// "templateEngine". The declared record key stays the long flag name.
export function camelKey(name: string): string {
  if (name.indexOf("-") < 0) {
    return name;
  }
  let out = "";
  let upper = false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charAt(i);
    if (c === "-") {
      upper = true;
      continue;
    }
    out = out + (upper ? c.toUpperCase() : c);
    upper = false;
  }
  return out;
}

function normalizeOptions(specOpts: Record<string, OptionInput>): Record<string, OptionDef> {
  const options: Record<string, OptionDef> = {};
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
    let optionalValue = false;
    let variadic = false;
    let negatable = false;
    let envName = "";
    let hidden = false;
    let schemaInput: SchemaInput | undefined;
    if (isSchemaValue(raw)) {
      schemaInput = raw as SchemaInput;
    } else {
      const sp = raw as OptionSpec;
      flag = sp.flag === true;
      optionalValue = sp.optionalValue === true;
      variadic = sp.variadic === true;
      negatable = sp.negatable === true;
      short = sp.short === undefined ? "" : sp.short;
      desc = sp.description === undefined ? "" : sp.description;
      metavar = sp.metavar === undefined ? "" : sp.metavar;
      envName = sp.env === undefined ? "" : sp.env;
      hidden = sp.hidden === true;
      if (sp.schema !== undefined) {
        schemaInput = sp.schema;
      }
      if (sp.default !== undefined) {
        hasDefault = true;
        defaultValue = sp.default;
      }
    }
    if (flag && (optionalValue || variadic)) {
      throw new Error("E_BAD_OPTION: --" + name + " flag cannot be optionalValue or variadic");
    }
    if (optionalValue && variadic) {
      throw new Error("E_BAD_OPTION: --" + name + " cannot be both optionalValue and variadic");
    }
    if (negatable && !flag) {
      throw new Error("E_BAD_OPTION: --" + name + " negatable applies to flags only");
    }
    const def: OptionDef = {
      flag: flag,
      optionalValue: optionalValue,
      variadic: variadic,
      negatable: negatable,
      short: short,
      envName: envName,
      hidden: hidden,
      hasDefault: hasDefault,
      defaultValue: defaultValue,
      description: desc,
      metavar: metavar,
      schema: normalizeSchema(schemaInput, "--" + name),
      optsKey: camelKey(name),
    };
    if (def.short.length > 1) {
      throw new Error("E_BAD_OPTION: --" + name + " short must be a single character");
    }
    // optsKey collision: "x-y" + "xY" normalize to the same opts member.
    const seen = Object.entries(options);
    for (let s = 0; s < seen.length; s++) {
      if (seen[s][1].optsKey === def.optsKey) {
        throw new Error(
          "E_BAD_OPTION: --" +
            name +
            " and --" +
            seen[s][0] +
            " share opts key '" +
            def.optsKey +
            "'",
        );
      }
    }
    if (def.hasDefault) {
      // The default goes through the schema: issues → E_BAD_OPTION with the
      // validator's own message; a morph output becomes the stored default.
      if (def.schema !== null) {
        if (def.variadic) {
          const arr = def.defaultValue;
          if (!Array.isArray(arr)) {
            throw new Error("E_BAD_OPTION: default for --" + name + " must be an array");
          }
          const outs: unknown[] = [];
          for (let d = 0; d < arr.length; d++) {
            const oc = validateValue(def.schema, arr[d], "--" + name);
            if (oc.error !== "") {
              throw new Error("E_BAD_OPTION: " + oc.error);
            }
            outs.push(oc.hasOut ? oc.out : arr[d]);
          }
          def.defaultValue = outs;
        } else {
          const oc = validateValue(def.schema, def.defaultValue, "--" + name);
          if (oc.error !== "") {
            throw new Error("E_BAD_OPTION: " + oc.error);
          }
          if (oc.hasOut) {
            def.defaultValue = oc.out;
          }
        }
      } else {
        let ok = def.flag
          ? typeof def.defaultValue === "boolean"
          : typeof def.defaultValue === "string";
        if (def.variadic) {
          ok = Array.isArray(def.defaultValue);
        }
        if (!ok) {
          throw new Error(
            "E_BAD_OPTION: default for --" +
              name +
              (def.flag
                ? " must be a boolean"
                : def.variadic
                  ? " must be an array"
                  : " must be a string (declare a schema for other types)"),
          );
        }
      }
    }
    options[name] = def;
  }
  return options;
}

function normalizeArgs(specArgs: readonly ArgInput[]): ArgDef[] {
  const defs: ArgDef[] = [];
  let sawOptional = false;
  for (let i = 0; i < specArgs.length; i++) {
    const entry = specArgs[i];
    const def: ArgDef = {
      name: "",
      optional: false,
      variadic: false,
      hasDefault: false,
      defaultValue: null,
      description: "",
      schema: null,
    };
    if (typeof entry === "string") {
      def.name = entry;
    } else {
      def.name = entry.name;
      def.optional = entry.optional === true;
      def.variadic = entry.variadic === true;
      def.description = entry.description === undefined ? "" : entry.description;
      def.schema = normalizeSchema(entry.schema, "<" + entry.name + ">");
      if (entry.default !== undefined) {
        def.hasDefault = true;
        def.defaultValue = entry.default;
      }
    }
    if (def.name === "") {
      throw new Error("E_BAD_OPTION: positional arg needs a name");
    }
    if (def.variadic && i !== specArgs.length - 1) {
      throw new Error("E_BAD_OPTION: variadic arg <" + def.name + "> must be last");
    }
    if (sawOptional && !def.optional && !def.variadic) {
      throw new Error(
        "E_BAD_OPTION: required arg <" + def.name + "> cannot follow an optional arg",
      );
    }
    if (def.optional) {
      sawOptional = true;
    }
    if (def.hasDefault && def.schema !== null) {
      const oc = validateValue(def.schema, def.defaultValue, "<" + def.name + ">");
      if (oc.error !== "") {
        throw new Error("E_BAD_OPTION: " + oc.error);
      }
      if (oc.hasOut) {
        def.defaultValue = oc.out;
      }
    }
    defs.push(def);
  }
  return defs;
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

// The program spec is a root node: same normalization as command() minus
// the wrapper. run()/runAsync() call this once per invocation.
function normalizeRoot<O extends Record<string, OptionInput>, A extends readonly ArgInput[]>(
  prog: ProgramSpec<O, A>,
): CommandDef {
  const cmds = prog.commands === undefined ? {} : prog.commands;
  const h =
    prog.handler === undefined
      ? null
      : (prog.handler as (opts: unknown, args: unknown[]) => unknown);
  return {
    description: prog.description === undefined ? "" : prog.description,
    args: normalizeArgs(prog.args === undefined ? [] : prog.args),
    options: normalizeOptions(prog.options === undefined ? {} : prog.options),
    commands: cmds,
    aliases: [],
    hidden: false,
    schema: normalizeSchema(prog.schema, "program"),
    handler: h,
  };
}

// ---------------------------------------------------------------- run()

// Returns the process exit code; prints help to stdout and errors to
// stderr. Typical entry point: `process.exit(run({...}))` — run() itself
// never exits, so it stays unit-testable under plain Node. A handler or
// validator returning a Promise is a clean error — use runAsync.
export function run<
  O extends Record<string, OptionInput>,
  const A extends readonly ArgInput[] = readonly ArgInput[],
>(prog: ProgramSpec<O, A>, argv?: string[]): number {
  const args = argv === undefined ? process.argv.slice(2) : argv;
  // Upcast before touching the spec — a value declared with the generic
  // ProgramSpec<O,A> type has no static lowering (SC6104 dynamic slot).
  const root = normalizeRoot(prog as ProgramSpec<Record<string, OptionInput>, readonly ArgInput[]>);
  const head = prog as ProgramHead;
  const code = runNode(head, head.name, root, args);
  return code === -1 ? 1 : code;
}

// Async twin: awaits Promise-returning handlers and Promise-returning
// Standard Schema validators. Entry idiom for Node or ELF:
// `runAsync(prog).then((c) => process.exit(c))` (avoids top-level await).
export function runAsync<
  O extends Record<string, OptionInput>,
  const A extends readonly ArgInput[] = readonly ArgInput[],
>(prog: ProgramSpec<O, A>, argv?: string[]): Promise<number> {
  const args = argv === undefined ? process.argv.slice(2) : argv;
  const root = normalizeRoot(prog as ProgramSpec<Record<string, OptionInput>, readonly ArgInput[]>);
  const head = prog as ProgramHead;
  return runNodeAsync(head, head.name, root, args);
}

// ---------------------------------------------------------------- parsing

function fail(msg: string): number {
  console.error("error: " + msg);
  return 1;
}

// Find a subcommand or alias by name; returns the [name, def] entry or null.
function findCommand(cmds: Record<string, CommandDef>, name: string): [string, CommandDef] | null {
  const entries = Object.entries(cmds);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][0] === name) {
      return entries[i];
    }
    const aliases = entries[i][1].aliases;
    for (let a = 0; a < aliases.length; a++) {
      if (aliases[a] === name) {
        return entries[i];
      }
    }
  }
  return null;
}

// The token-scanning half of descent — identical for sync and async runs.
// Fills `values` (raw effective option values) and `positionals`; returns
// early via `done` (help/version printed, or an error already reported) or
// signals descent into `child`/`rest`/`helpTokens`.
interface Scan {
  done: boolean; // run() should return `code` immediately
  code: number;
  descend: boolean; // a subcommand matched — descend into child/rest
  child: CommandDef | null;
  childName: string;
  rest: string[];
  helpTokens: string[]; // `help <path…>` walk request
  values: Record<string, unknown>;
  positionals: string[];
  unknownCommand: string; // "" or the unmatched operand (commands + no args)
}

function seedValues(optionEntries: [string, OptionDef][]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  // Seed every declared key: validated default, else env value, else the
  // zero value — false for flags, [] for variadic, "" for value-options.
  for (let i = 0; i < optionEntries.length; i++) {
    const def = optionEntries[i][1];
    const key = def.optsKey;
    if (def.hasDefault) {
      values[key] = def.defaultValue;
    } else if (def.envName !== "" && process.env[def.envName] !== undefined) {
      values[key] = process.env[def.envName];
    } else if (def.flag) {
      values[key] = false;
    } else if (def.variadic) {
      values[key] = [];
    } else {
      values[key] = "";
    }
  }
  return values;
}

function scanNode(prog: ProgramHead, pathLabel: string, node: CommandDef, args: string[]): Scan {
  const optionEntries = Object.entries(node.options);
  const cmdEntries = Object.entries(node.commands);
  const hasCommands = cmdEntries.length > 0;
  const values = seedValues(optionEntries);
  const positionals: string[] = [];
  const out: Scan = {
    done: false,
    code: 0,
    descend: false,
    child: null,
    childName: "",
    rest: [],
    helpTokens: [],
    values: values,
    positionals: positionals,
    unknownCommand: "",
  };

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
      printNodeHelp(prog, pathLabel, node);
      out.done = true;
      return out;
    }
    if (tok === "--version" && pathLabel === prog.name) {
      if (prog.version === undefined) {
        console.log(prog.name);
      } else {
        console.log(prog.name + " " + prog.version);
      }
      out.done = true;
      return out;
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
      let k = findLong(optionEntries, body);
      // Negated flag form: --no-<name> sets a negatable flag to false.
      if (k < 0 && body.length > 3 && body.substring(0, 3) === "no-") {
        const base = body.substring(3);
        const nk = findLong(optionEntries, base);
        if (nk >= 0 && optionEntries[nk][1].flag && optionEntries[nk][1].negatable) {
          if (hasAttached) {
            out.done = true;
            out.code = fail("--no-" + base + " takes no value");
            return out;
          }
          values[optionEntries[nk][1].optsKey] = false;
          i = i + 1;
          continue;
        }
      }
      if (k < 0) {
        out.done = true;
        out.code = fail("unknown option '--" + body + "'");
        return out;
      }
      const def = optionEntries[k][1];
      if (def.flag) {
        if (!hasAttached) {
          values[def.optsKey] = true;
        } else {
          values[def.optsKey] = attached;
        }
      } else if (def.optionalValue) {
        if (hasAttached) {
          values[def.optsKey] = attached;
        } else {
          values[def.optsKey] = true;
        }
      } else if (def.variadic) {
        if (hasAttached) {
          pushVar(values, def.optsKey, attached);
        } else {
          let took = 0;
          while (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
            pushVar(values, def.optsKey, args[i + 1]);
            i = i + 1;
            took = took + 1;
          }
          if (took === 0) {
            out.done = true;
            out.code = fail("--" + body + " requires at least one value");
            return out;
          }
        }
      } else {
        let raw = "";
        if (hasAttached) {
          raw = attached;
        } else {
          if (i + 1 >= args.length) {
            out.done = true;
            out.code = fail("--" + body + " requires a value");
            return out;
          }
          i = i + 1;
          raw = args[i];
        }
        values[def.optsKey] = raw;
      }
      i = i + 1;
      continue;
    }
    if (tok.length > 1 && tok.charAt(0) === "-") {
      // Short cluster: -u, -t 3, -t3, -ut3 (flag shorts may cluster; a
      // value-taking short consumes the rest of the token or next arg).
      let j = 1;
      let bail = false;
      while (j < tok.length) {
        const c = tok.charAt(j);
        const k = findShort(optionEntries, c);
        if (k < 0) {
          if (c === "h" && j === 1 && tok.length === 2) {
            printNodeHelp(prog, pathLabel, node);
            out.done = true;
            return out;
          }
          out.done = true;
          out.code = fail("unknown option '-" + c + "'");
          return out;
        }
        const def = optionEntries[k][1];
        if (def.flag) {
          values[def.optsKey] = true;
          j = j + 1;
          continue;
        }
        if (def.optionalValue) {
          // -x bare → true; -xv or -x=v → "v"; -x v keeps v a positional.
          if (j + 1 < tok.length) {
            let raw = tok.substring(j + 1);
            if (raw.charAt(0) === "=") {
              raw = raw.substring(1);
            }
            values[def.optsKey] = raw;
          } else {
            values[def.optsKey] = true;
          }
          j = tok.length;
          continue;
        }
        if (def.variadic) {
          if (j + 1 < tok.length) {
            let raw = tok.substring(j + 1);
            if (raw.charAt(0) === "=") {
              raw = raw.substring(1);
            }
            pushVar(values, def.optsKey, raw);
          } else {
            let took = 0;
            while (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
              pushVar(values, def.optsKey, args[i + 1]);
              i = i + 1;
              took = took + 1;
            }
            if (took === 0) {
              out.done = true;
              out.code = fail("-" + c + " requires at least one value");
              bail = true;
              break;
            }
          }
          j = tok.length;
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
            out.done = true;
            out.code = fail("-" + c + " requires a value");
            bail = true;
            break;
          }
          i = i + 1;
          raw = args[i];
        }
        values[def.optsKey] = raw;
        j = tok.length;
      }
      if (bail) {
        return out;
      }
      i = i + 1;
      continue;
    }
    // Non-option token: subcommand/alias match descends (parent options
    // before the token stay bound to the parent); `help` walks the tree.
    if (hasCommands) {
      if (tok === "help") {
        const rest: string[] = [];
        for (let r = i + 1; r < args.length; r++) {
          rest.push(args[r]);
        }
        out.helpTokens = rest;
        return out;
      }
      const found = findCommand(node.commands, tok);
      if (found !== null) {
        out.descend = true;
        out.child = found[1];
        out.childName = found[0];
        const rest: string[] = [];
        for (let r = i + 1; r < args.length; r++) {
          rest.push(args[r]);
        }
        out.rest = rest;
        return out;
      }
      if (node.args.length === 0) {
        // Commands-only node: an unmatched operand is an unknown command.
        const names: string[] = [];
        for (let c = 0; c < cmdEntries.length; c++) {
          names.push(cmdEntries[c][0]);
          const al = cmdEntries[c][1].aliases;
          for (let a = 0; a < al.length; a++) {
            names.push(al[a]);
          }
        }
        const sug = suggest(tok, names);
        out.done = true;
        out.code =
          sug === ""
            ? fail("unknown command '" + tok + "'")
            : fail("unknown command '" + tok + "' — did you mean '" + sug + "'?");
        return out;
      }
    }
    positionals.push(tok);
    i = i + 1;
  }
  return out;
}

// values[key] reads are dynamic-record-read safe (writes only); reads go
// through valueOf(). pushVar appends to the variadic array — and always
// re-stores it, because an `as string[]` cast on a record-read value may
// produce a copy under scriptc (mutating the cast result silently loses
// elements in the ELF; verified empirically 2026-11-08).
function pushVar(values: Record<string, unknown>, key: string, item: string): void {
  const cur = valueOf(values, key);
  const arr = Array.isArray(cur) ? (cur as string[]) : [];
  arr.push(item);
  values[key] = arr;
}

// Assign collected positionals to the declared ArgDefs and run each arg
// schema (sync). Returned `args` is the dense slot array handed to the
// handler — absent optionals hold their validated default or null.
interface Assigned {
  error: string; // "" = ok
  args: unknown[];
}

function assignArgs(node: CommandDef, positionals: string[]): Assigned {
  const defs = node.args;
  const slots: unknown[] = [];
  let pos = 0;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (def.variadic) {
      const rest: unknown[] = [];
      while (pos < positionals.length) {
        const oc = validateArg(def, positionals[pos]);
        if (oc.error !== "") {
          return { error: oc.error, args: [] };
        }
        rest.push(oc.hasOut ? oc.out : positionals[pos]);
        pos = pos + 1;
      }
      if (!def.optional && rest.length === 0) {
        return { error: "missing required argument '" + def.name + "'", args: [] };
      }
      slots.push(rest);
      continue;
    }
    if (pos < positionals.length) {
      const oc = validateArg(def, positionals[pos]);
      if (oc.error !== "") {
        return { error: oc.error, args: [] };
      }
      slots.push(oc.hasOut ? oc.out : positionals[pos]);
      pos = pos + 1;
      continue;
    }
    if (def.optional) {
      slots.push(def.hasDefault ? def.defaultValue : null);
      continue;
    }
    return { error: "missing required argument '" + def.name + "'", args: [] };
  }
  if (pos < positionals.length) {
    return { error: "unexpected argument '" + positionals[pos] + "'", args: [] };
  }
  return { error: "", args: slots };
}

// Async twin of assignArgs: identical walk, but each arg schema outcome is
// awaited so Promise-returning validators work under runAsync.
async function assignArgsAsync(node: CommandDef, positionals: string[]): Promise<Assigned> {
  const defs = node.args;
  const slots: unknown[] = [];
  let pos = 0;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (def.variadic) {
      const rest: unknown[] = [];
      while (pos < positionals.length) {
        const oc = await validateArgAsync(def, positionals[pos]);
        if (oc.error !== "") {
          return { error: oc.error, args: [] };
        }
        rest.push(oc.hasOut ? oc.out : positionals[pos]);
        pos = pos + 1;
      }
      if (!def.optional && rest.length === 0) {
        return { error: "missing required argument '" + def.name + "'", args: [] };
      }
      slots.push(rest);
      continue;
    }
    if (pos < positionals.length) {
      const oc = await validateArgAsync(def, positionals[pos]);
      if (oc.error !== "") {
        return { error: oc.error, args: [] };
      }
      slots.push(oc.hasOut ? oc.out : positionals[pos]);
      pos = pos + 1;
      continue;
    }
    if (def.optional) {
      slots.push(def.hasDefault ? def.defaultValue : null);
      continue;
    }
    return { error: "missing required argument '" + def.name + "'", args: [] };
  }
  if (pos < positionals.length) {
    return { error: "unexpected argument '" + positionals[pos] + "'", args: [] };
  }
  return { error: "", args: slots };
}

function validateArg(def: ArgDef, raw: string): ValidateOutcome {
  if (def.schema === null) {
    return { error: "", hasOut: false, out: null };
  }
  return validateValue(def.schema, raw, "<" + def.name + ">");
}

async function validateArgAsync(def: ArgDef, raw: string): Promise<ValidateOutcome> {
  if (def.schema === null) {
    return { error: "", hasOut: false, out: null };
  }
  return validateValueAsync(def.schema, raw, "<" + def.name + ">");
}

// The schema boundary: every option's effective value (explicit, env,
// default, or zero) passes its validator and the OUTPUT is stored — morphs
// apply. Schema-less flags coerce "true"/"1"/"false"/"0" attached forms.
// Variadic options validate per element and store the outputs array.
function validateOptsSync(
  optionEntries: [string, OptionDef][],
  values: Record<string, unknown>,
): string {
  for (let e = 0; e < optionEntries.length; e++) {
    const def = optionEntries[e][1];
    const v = valueOf(values, def.optsKey);
    if (def.schema !== null) {
      if (def.variadic) {
        const outs: unknown[] = [];
        const arr = Array.isArray(v) ? (v as unknown[]) : [];
        for (let m = 0; m < arr.length; m++) {
          const oc = validateValue(def.schema, arr[m], "--" + optionEntries[e][0]);
          if (oc.error !== "") {
            return oc.error;
          }
          outs.push(oc.hasOut ? oc.out : arr[m]);
        }
        values[def.optsKey] = outs;
      } else {
        const oc = validateValue(def.schema, v, "--" + optionEntries[e][0]);
        if (oc.error !== "") {
          return oc.error;
        }
        if (oc.hasOut) {
          values[def.optsKey] = oc.out;
        }
      }
    } else if (def.flag && typeof v === "string") {
      if (v === "true" || v === "1") {
        values[def.optsKey] = true;
      } else if (v === "false" || v === "0") {
        values[def.optsKey] = false;
      } else {
        return "--" + optionEntries[e][0] + ": expected a boolean, got '" + v + "'";
      }
    }
  }
  return "";
}

async function validateOptsAsync(
  optionEntries: [string, OptionDef][],
  values: Record<string, unknown>,
): Promise<string> {
  for (let e = 0; e < optionEntries.length; e++) {
    const def = optionEntries[e][1];
    const v = valueOf(values, def.optsKey);
    if (def.schema !== null) {
      if (def.variadic) {
        const outs: unknown[] = [];
        const arr = Array.isArray(v) ? (v as unknown[]) : [];
        for (let m = 0; m < arr.length; m++) {
          const oc = await validateValueAsync(def.schema, arr[m], "--" + optionEntries[e][0]);
          if (oc.error !== "") {
            return oc.error;
          }
          outs.push(oc.hasOut ? oc.out : arr[m]);
        }
        values[def.optsKey] = outs;
      } else {
        const oc = await validateValueAsync(def.schema, v, "--" + optionEntries[e][0]);
        if (oc.error !== "") {
          return oc.error;
        }
        if (oc.hasOut) {
          values[def.optsKey] = oc.out;
        }
      }
    } else if (def.flag && typeof v === "string") {
      if (v === "true" || v === "1") {
        values[def.optsKey] = true;
      } else if (v === "false" || v === "0") {
        values[def.optsKey] = false;
      } else {
        return "--" + optionEntries[e][0] + ": expected a boolean, got '" + v + "'";
      }
    }
  }
  return "";
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

async function validateValueAsync(
  v: StandardValidator,
  value: unknown,
  label: string,
): Promise<ValidateOutcome> {
  const r = v.validate(value);
  const rr = r instanceof Promise ? await r : r;
  const issues = rr.issues;
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
  if (rr.value !== undefined) {
    return { error: "", hasOut: true, out: rr.value };
  }
  return { error: "", hasOut: false, out: null };
}

// ---------------------------------------------------------------- descent

// Command-level schema on {opts,args}, then handler dispatch. Reached at a
// leaf or at a group that ran out of subcommand tokens.
function finishNodeSync(
  prog: ProgramHead,
  pathLabel: string,
  node: CommandDef,
  values: Record<string, unknown>,
  slots: unknown[],
): number {
  const optionEntries = Object.entries(node.options);
  const vErr = validateOptsSync(optionEntries, values);
  if (vErr !== "") {
    return fail(vErr);
  }
  if (node.schema !== null) {
    const input: ParsedInput = { opts: values, args: slots };
    const oc = validateValue(node.schema, input, pathLabel);
    if (oc.error !== "") {
      return fail(oc.error);
    }
  }
  if (node.handler === null) {
    printNodeHelp(prog, pathLabel, node);
    return 0;
  }
  const r = node.handler(values, slots);
  if (r instanceof Promise) {
    return fail("handler returned a Promise — use runAsync(prog)");
  }
  return 0;
}

async function finishNodeAsync(
  prog: ProgramHead,
  pathLabel: string,
  node: CommandDef,
  values: Record<string, unknown>,
  slots: unknown[],
): Promise<number> {
  const optionEntries = Object.entries(node.options);
  const vErr = await validateOptsAsync(optionEntries, values);
  if (vErr !== "") {
    return fail(vErr);
  }
  if (node.schema !== null) {
    const input: ParsedInput = { opts: values, args: slots };
    const oc = await validateValueAsync(node.schema, input, pathLabel);
    if (oc.error !== "") {
      return fail(oc.error);
    }
  }
  if (node.handler === null) {
    printNodeHelp(prog, pathLabel, node);
    return 0;
  }
  const r = node.handler(values, slots);
  if (r instanceof Promise) {
    await r;
  }
  return 0;
}

// `help <path…>` — walk the tree by command names and print that node's
// help. Unknown segments fall back to the suggestion machinery.
function walkHelp(
  prog: ProgramHead,
  pathLabel: string,
  node: CommandDef,
  tokens: string[],
): number {
  if (tokens.length === 0) {
    printNodeHelp(prog, pathLabel, node);
    return 0;
  }
  const found = findCommand(node.commands, tokens[0]);
  if (found === null) {
    const entries = Object.entries(node.commands);
    const names: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      names.push(entries[i][0]);
    }
    const sug = suggest(tokens[0], names);
    return sug === ""
      ? fail("unknown command '" + tokens[0] + "'")
      : fail("unknown command '" + tokens[0] + "' — did you mean '" + sug + "'?");
  }
  const rest: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    rest.push(tokens[i]);
  }
  return walkHelp(prog, pathLabel + " " + found[0], found[1], rest);
}

function runNode(prog: ProgramHead, pathLabel: string, node: CommandDef, args: string[]): number {
  let cur = node;
  let curArgs = args;
  let path = pathLabel;
  for (;;) {
    const sc = scanNode(prog, path, cur, curArgs);
    if (sc.helpTokens.length > 0) {
      return walkHelp(prog, path, cur, sc.helpTokens);
    }
    if (sc.done) {
      return sc.code;
    }
    const asg = assignArgs(cur, sc.positionals);
    if (asg.error !== "") {
      return fail(asg.error);
    }
    if (sc.descend && sc.child !== null) {
      // Parent opts/args/schema validate before descent (a bad --parent
      // flag fails at the parent even when the command line continues
      // below into a subcommand).
      const optionEntries = Object.entries(cur.options);
      const vErr = validateOptsSync(optionEntries, sc.values);
      if (vErr !== "") {
        return fail(vErr);
      }
      if (cur.schema !== null) {
        const input: ParsedInput = { opts: sc.values, args: asg.args };
        const oc = validateValue(cur.schema, input, path);
        if (oc.error !== "") {
          return fail(oc.error);
        }
      }
      path = path + " " + sc.childName;
      cur = sc.child;
      curArgs = sc.rest;
      continue;
    }
    return finishNodeSync(prog, path, cur, sc.values, asg.args);
  }
}

async function runNodeAsync(
  prog: ProgramHead,
  pathLabel: string,
  node: CommandDef,
  args: string[],
): Promise<number> {
  let cur = node;
  let curArgs = args;
  let path = pathLabel;
  for (;;) {
    const sc = scanNode(prog, path, cur, curArgs);
    if (sc.helpTokens.length > 0) {
      return walkHelp(prog, path, cur, sc.helpTokens);
    }
    if (sc.done) {
      return sc.code;
    }
    const asg = await assignArgsAsync(cur, sc.positionals);
    if (asg.error !== "") {
      return fail(asg.error);
    }
    if (sc.descend && sc.child !== null) {
      const optionEntries = Object.entries(cur.options);
      const vErr = await validateOptsAsync(optionEntries, sc.values);
      if (vErr !== "") {
        return fail(vErr);
      }
      if (cur.schema !== null) {
        const input: ParsedInput = { opts: sc.values, args: asg.args };
        const oc = await validateValueAsync(cur.schema, input, path);
        if (oc.error !== "") {
          return fail(oc.error);
        }
      }
      path = path + " " + sc.childName;
      cur = sc.child;
      curArgs = sc.rest;
      continue;
    }
    return finishNodeAsync(prog, path, cur, sc.values, asg.args);
  }
}

// ---------------------------------------------------------------- help

function pad(s: string, w: number): string {
  let out = s;
  while (out.length < w) {
    out = out + " ";
  }
  return out;
}

// metavar label for one declared arg: <req> / [opt] / <var...> / [var...].
function argLabel(def: ArgDef): string {
  let inner = def.name;
  if (def.variadic) {
    inner = inner + "...";
  }
  return def.optional ? "[" + inner + "]" : "<" + inner + ">";
}

// One help for every level: root prints the name/version/description head,
// subcommands print `path — desc`. Sections: Usage / Arguments / Commands /
// Options, each rendered only when non-empty.
function printNodeHelp(prog: ProgramHead, pathLabel: string, node: CommandDef): void {
  const isRoot = pathLabel === prog.name;
  if (isRoot) {
    let head = prog.name;
    if (prog.version !== undefined) {
      head = head + " " + prog.version;
    }
    if (node.description !== "") {
      head = head + " — " + node.description;
    }
    console.log(head);
    console.log("");
  } else {
    console.log(pathLabel + " — " + node.description);
    console.log("");
  }
  const optionEntries = Object.entries(node.options);
  const cmdEntries = Object.entries(node.commands);
  let usage = "Usage: " + pathLabel;
  for (let i = 0; i < node.args.length; i++) {
    usage = usage + " " + argLabel(node.args[i]);
  }
  if (cmdEntries.length > 0) {
    usage = usage + " <command>";
  }
  if (optionEntries.length > 0 || isRoot) {
    usage = usage + " [options]";
  }
  console.log(usage);
  if (node.args.length > 0) {
    console.log("");
    console.log("Arguments:");
    const labels: string[] = [];
    const descs: string[] = [];
    for (let i = 0; i < node.args.length; i++) {
      labels.push(argLabel(node.args[i]));
      descs.push(node.args[i].description);
    }
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
  // Commands section: visible (non-hidden) children, `name|alias` labels.
  let visCount = 0;
  for (let i = 0; i < cmdEntries.length; i++) {
    if (!cmdEntries[i][1].hidden) {
      visCount = visCount + 1;
    }
  }
  if (visCount > 0) {
    console.log("");
    console.log("Commands:");
    const labels: string[] = [];
    const descs: string[] = [];
    for (let i = 0; i < cmdEntries.length; i++) {
      const cmd = cmdEntries[i][1];
      if (cmd.hidden) {
        continue;
      }
      let label = cmdEntries[i][0];
      for (let a = 0; a < cmd.aliases.length; a++) {
        label = label + "|" + cmd.aliases[a];
      }
      labels.push(label);
      descs.push(cmd.description);
    }
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
  console.log("");
  console.log("Options:");
  const labels: string[] = [];
  const descs: string[] = [];
  for (let i = 0; i < optionEntries.length; i++) {
    const name = optionEntries[i][0];
    const def = optionEntries[i][1];
    if (def.hidden) {
      continue;
    }
    let label = "";
    if (def.short !== "") {
      label = "-" + def.short + ", --" + name;
    } else {
      label = "    --" + name;
    }
    if (def.flag) {
      if (def.negatable) {
        label = label + ", --no-" + name;
      }
    } else {
      const meta = def.metavar !== "" ? def.metavar : name;
      if (def.optionalValue) {
        label = label + " [<" + meta + ">]";
      } else if (def.variadic) {
        label = label + " <" + meta + "...>";
      } else {
        label = label + " <" + meta + ">";
      }
    }
    let desc = def.description;
    if (def.hasDefault) {
      desc = desc + " (default: " + String(def.defaultValue) + ")";
    }
    if (def.envName !== "") {
      desc = desc + " (env: " + def.envName + ")";
    }
    labels.push(label);
    descs.push(desc);
  }
  labels.push("-h, --help");
  descs.push("show help");
  if (isRoot) {
    labels.push("    --version");
    descs.push("show version");
  }
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
