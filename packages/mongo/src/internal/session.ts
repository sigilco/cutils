// Session — owns the SocketChannel, issues OP_MSG commands, drives the
// handshake (hello) and auth, and tracks the next requestId. All commands
// go through `command(db, spec, seqs)`; the session serializes them on the
// single socket. One retry of idempotent reads/writes lives in
// `commandMaybeRetry`, honoring retryReads/retryWrites.

import { codeNameFor, MongoError, mongoError } from "../errors.ts";
import { getArr, getNum, getStr, getVal, vI32, vObj, vStr } from "../bson/value.ts";
import type { BsonDoc } from "../bson/value.ts";
import { decodeMsg, DocSeq, encodeMsg } from "./opmsg.ts";
import { connectTcp, connectTls, SocketChannel } from "./socket.ts";
import { parseUri, resolveHost } from "./uri.ts";
import { scramAuth } from "./auth.ts";
import type { TxnState } from "./transaction.ts";
import { txnFields } from "./commands.ts";

export interface SessionOpts {
  uri: string;
  appName: string;
  connectTimeoutMs: number;
  retryReads: boolean;
  retryWrites: boolean;
}

export class Session {
  ch: SocketChannel | null;
  nextId: number;
  opts: SessionOpts;
  serverVersion: string;
  maxWireVersion: number;
  connected: boolean;
  /** Set while a transaction is open — every command gets lsid/txnNumber. */
  activeTxn: TxnState | null;

  constructor(opts: SessionOpts) {
    this.ch = null;
    this.nextId = 1;
    this.opts = opts;
    this.serverVersion = "";
    this.maxWireVersion = 0;
    this.connected = false;
    this.activeTxn = null;
  }

  async connect(): Promise<void> {
    const parsed = parseUri(this.opts.uri);
    const seed = parsed.seeds[0];
    let host = seed.host;
    if (parsed.isSrv) {
      host = await resolveHost(seed.host);
    }
    const ch = await openChannel(
      this.opts.uri,
      parsed.tlsRequired,
      host,
      seed.port,
      this.opts.connectTimeoutMs,
    );
    this.ch = ch;
    this.connected = true;
    const hello = await this.rawCommand("admin", helloSpec(this.opts.appName), []);
    this.serverVersion = getStr(hello, "version");
    this.maxWireVersion = getNum(hello, "maxWireVersion");
    await this.authenticate(
      parsed.user,
      parsed.pass,
      optOr(parsed.options, "authSource"),
      parsed.dbName,
      optOr(parsed.options, "authMechanism"),
    );
  }

  async authenticate(
    user: string,
    pass: string,
    authSource: string,
    dbName: string,
    authMechanism: string,
  ): Promise<void> {
    if (user === "") {
      return;
    }
    const authDb = authSource !== "" ? authSource : dbName !== "" ? dbName : "admin";
    const mech = authMechanism !== "" ? authMechanism : "SCRAM-SHA-256";
    const mechNorm = mech === "SCRAM-SHA-1" ? "SCRAM-SHA-1" : "SCRAM-SHA-256";
    await scramAuth((db: string, spec: BsonDoc) => this.rawCommand(db, spec, []), {
      mechanism: mechNorm,
      username: user,
      password: pass,
      authDb: authDb,
    });
  }

  async rawCommand(db: string, spec: BsonDoc, seqs: DocSeq[]): Promise<BsonDoc> {
    if (this.ch === null) {
      throw mongoError("NetworkError", "session not connected");
    }
    // A missing key on a typed record throws under scriptc — test
    // membership instead of reading-then-checking for undefined.
    if (Object.keys(spec).indexOf("$db") < 0) {
      spec["$db"] = vStr(db);
    }
    const id = this.nextId;
    this.nextId = this.nextId + 1;
    const frame = encodeMsg(id, spec, seqs);
    this.ch.write(frame);
    const resp = await this.ch.readFrame(30000);
    const msg = decodeMsg(resp);
    return msg.body;
  }

  /** Command with ok-check + writeConcernError/writeErrors surfacing.
   * When a transaction is active on this session, stamps lsid/txnNumber/
   * autocommit (startTransaction on the first stamped command). */
  async command(db: string, spec: BsonDoc, seqs: DocSeq[]): Promise<BsonDoc> {
    if (this.activeTxn !== null && Object.keys(spec).indexOf("lsid") < 0) {
      txnFields(spec, this.activeTxn.lsid, this.activeTxn.txnNumber, this.activeTxn.started, false);
      this.activeTxn.started = false;
    }
    const body = await this.rawCommand(db, spec, seqs);
    checkReply(body);
    return body;
  }

  /** One-shot command honoring retryReads/retryWrites. `kind` is "read" |
   * "write" | "admin" (admin never retries). */
  async commandMaybeRetry(
    db: string,
    spec: BsonDoc,
    seqs: DocSeq[],
    kind: string,
  ): Promise<BsonDoc> {
    try {
      return await this.command(db, spec, seqs);
    } catch (e) {
      if (!isNetworkError(e)) {
        throw e;
      }
      // Commands inside a transaction never retry.
      let retryable = this.activeTxn === null;
      if (kind === "read" && !this.opts.retryReads) {
        retryable = false;
      }
      if (kind === "write" && !this.opts.retryWrites) {
        retryable = false;
      }
      if (!retryable) {
        throw e;
      }
      await this.reconnectOnce();
      return this.command(db, spec, seqs);
    }
  }

  async reconnectOnce(): Promise<void> {
    this.close();
    const parsed = parseUri(this.opts.uri);
    const seed = parsed.seeds[0];
    let host = seed.host;
    if (parsed.isSrv) {
      host = await resolveHost(seed.host);
    }
    this.ch = await openChannel(
      this.opts.uri,
      parsed.tlsRequired,
      host,
      seed.port,
      this.opts.connectTimeoutMs,
    );
    this.connected = true;
    await this.authenticate(
      parsed.user,
      parsed.pass,
      optOr(parsed.options, "authSource"),
      parsed.dbName,
      optOr(parsed.options, "authMechanism"),
    );
  }

  close(): void {
    if (this.ch !== null) {
      this.ch.close();
      this.ch = null;
    }
    this.connected = false;
  }
}

/** String-valued record lookup that tolerates a missing key — a direct
 * `o[k]` read throws "record has no key" under scriptc. */
function optOr(o: { [k: string]: string }, k: string): string {
  if (Object.keys(o).indexOf(k) < 0) {
    return "";
  }
  return o[k];
}

function openChannel(
  uri: string,
  tlsRequired: boolean,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<SocketChannel> {
  const useTls = tlsRequired || uri.indexOf("tls=true") >= 0 || uri.indexOf("ssl=true") >= 0;
  const rejectUnauthorized =
    uri.indexOf("tlsInsecure=true") < 0 && uri.indexOf("tlsAllowInvalidCertificates=true") < 0;
  if (useTls) {
    return connectTls(host, port, host, rejectUnauthorized, timeoutMs);
  }
  return connectTcp(host, port, timeoutMs);
}

function helloSpec(appName: string): BsonDoc {
  const spec: BsonDoc = {};
  spec["hello"] = vI32(1);
  if (appName !== "") {
    const client: BsonDoc = {};
    const app: BsonDoc = {};
    app["name"] = vStr(appName);
    client["application"] = vObj(app);
    spec["client"] = vObj(client);
  }
  return spec;
}

export function isNetworkError(e: unknown): boolean {
  if (e instanceof MongoError) {
    return e.codeName === "NetworkError";
  }
  // net/tls errors surface as generic Error (ECONNRESET, ETIMEDOUT, ...)
  return e instanceof Error;
}

export function checkReply(body: BsonDoc): void {
  const ok = getNum(body, "ok");
  if (ok === 1) {
    const errs = getArr(body, "writeErrors");
    if (errs.length > 0 && errs[0].kind === "object") {
      const code = getNum(errs[0].v, "code");
      const name = getStr(errs[0].v, "codeName") || codeNameFor(code) || "WriteError";
      throw new MongoError({
        code: code,
        codeName: name,
        message: getStr(errs[0].v, "errmsg") || "write error",
      });
    }
    const wce = getVal(body, "writeConcernError");
    if (wce !== null && wce.kind === "object") {
      throw new MongoError({
        code: getNum(wce.v, "code"),
        codeName: getStr(wce.v, "codeName") || "WriteConcernError",
        message: getStr(wce.v, "errmsg") || "writeConcernError",
      });
    }
    return;
  }
  const code = getNum(body, "code");
  const name = getStr(body, "codeName") || codeNameFor(code);
  const msg = getStr(body, "errmsg");
  throw new MongoError({
    code: code,
    codeName: name !== "" ? name : "ServerError",
    message: msg !== "" ? msg : "command failed",
  });
}
