// mongodb:// and mongodb+srv:// URI parsing.
//
// srv: scriptc has no DNS SRV resolver — `lookup` is A-record only. We
// therefore do a best-effort A lookup on the domain, keep its default port
// (Atlas answer: 27017 behind an A record), and refuse multi-seed srv URIs
// unless the TXT-style `mongodb+srv` resolves. A documented limitation.

import { lookup } from "node:dns";
import { mongoError } from "../errors.ts";

export class SeedHost {
  host: string;
  port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
}

export class ParsedUri {
  seeds: SeedHost[];
  user: string;
  pass: string;
  dbName: string;
  options: { [k: string]: string };
  tlsRequired: boolean;
  isSrv: boolean;

  constructor() {
    this.seeds = [];
    this.user = "";
    this.pass = "";
    this.dbName = "";
    this.options = {};
    this.tlsRequired = false;
    this.isSrv = false;
  }
}

function decodeComponent(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.charAt(i) === "%" && i + 2 < s.length) {
      const h = s.slice(i + 1, i + 3);
      const code = parseInt(h, 16);
      out = out + String.fromCharCode(code);
      i = i + 3;
    } else {
      out = out + s.charAt(i);
      i = i + 1;
    }
  }
  return out;
}

/** String.prototype.lastIndexOf is not lowered under scriptc — scan back. */
function lastIndexOfChar(s: string, ch: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s.charAt(i) === ch) {
      return i;
    }
  }
  return -1;
}

function parseHostSpec(spec: string): SeedHost[] {
  const seeds: SeedHost[] = [];
  const parts = spec.split(",");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p === "") {
      continue;
    }
    const colon = lastIndexOfChar(p, ":");
    let host = p;
    let port = 27017;
    if (colon > 0) {
      host = p.slice(0, colon);
      port = parseInt(p.slice(colon + 1), 10);
    }
    seeds.push(new SeedHost(host, port));
  }
  return seeds;
}

export function parseUri(uri: string): ParsedUri {
  const out = new ParsedUri();
  let rest = "";
  if (uri.startsWith("mongodb+srv://")) {
    out.isSrv = true;
    out.tlsRequired = true;
    rest = uri.slice(14);
  } else if (uri.startsWith("mongodb://")) {
    rest = uri.slice(10);
  } else {
    throw mongoError("BadUri", "uri must start with mongodb:// or mongodb+srv://");
  }

  const slash = rest.indexOf("/");
  let authority = rest;
  let pathAndQuery = "";
  if (slash >= 0) {
    authority = rest.slice(0, slash);
    pathAndQuery = rest.slice(slash + 1);
  }

  // auth@ prefix
  const at = lastIndexOfChar(authority, "@");
  let hostSpec = authority;
  if (at >= 0) {
    const auth = authority.slice(0, at);
    hostSpec = authority.slice(at + 1);
    const colon = auth.indexOf(":");
    if (colon >= 0) {
      out.user = decodeComponent(auth.slice(0, colon));
      out.pass = decodeComponent(auth.slice(colon + 1));
    } else {
      out.user = decodeComponent(auth);
    }
  }
  out.seeds = parseHostSpec(hostSpec);
  if (out.seeds.length === 0) {
    throw mongoError("BadUri", "no hosts in uri");
  }
  if (out.isSrv && out.seeds.length > 1) {
    throw mongoError("BadUri", "mongodb+srv:// accepts exactly one hostname");
  }

  // path (dbName) + query
  const q = pathAndQuery.indexOf("?");
  let path = pathAndQuery;
  let query = "";
  if (q >= 0) {
    path = pathAndQuery.slice(0, q);
    query = pathAndQuery.slice(q + 1);
  }
  if (path !== "") {
    out.dbName = decodeComponent(path);
  }
  if (query !== "") {
    const pairs = query.split("&");
    for (let i = 0; i < pairs.length; i++) {
      const eq = pairs[i].indexOf("=");
      if (eq > 0) {
        const k = pairs[i].slice(0, eq);
        const v = decodeComponent(pairs[i].slice(eq + 1));
        out.options[k] = v;
      }
    }
  }
  return out;
}

/** IPv4 A-record lookup — the only DNS API scriptc exposes. */
export function resolveHost(host: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    lookup(host, { family: 4 }, (err: Error | null, addr: string) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(addr);
    });
  });
}
