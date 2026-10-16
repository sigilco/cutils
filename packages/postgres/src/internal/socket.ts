// node:net socket wrapper: connect, framed reads, and the single-flight
// request queue the Postgres wire protocol needs (one extended/simple
// exchange in flight per connection at a time).
//
// Data is push-based (`socket.on("data")`): every complete backend message
// is dispatched immediately — async traffic (NotificationResponse,
// ParameterStatus, NoticeResponse) is handled here, everything else is
// queued into the in-flight `Exchange`, which consumers pop via `next()`.

import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { Msg, Reader } from "./buffer.ts";
import {
  B_BACKEND_KEY,
  B_NOTIFY,
  B_NOTICE,
  B_PARAM_STATUS,
  B_READY,
  decodeNotify,
  decodeParamStatus,
  decodeErrorFields,
} from "./messages.ts";
import type { NotifyMsg } from "./messages.ts";
import { PgError } from "../errors.ts";

export interface BackendKey {
  pid: number;
  secret: number;
}

/** One in-flight request/response exchange: a message queue + completion. */
export class Exchange {
  _msgs: Msg[];
  _done: boolean;
  _err: PgError | null;
  _txStatus: string;
  _waiter: (() => void) | null;
  key: BackendKey | null;

  constructor() {
    this._msgs = [];
    this._done = false;
    this._err = null;
    this._txStatus = "I";
    this._waiter = null;
    this.key = null;
  }

  push(m: Msg): void {
    this._msgs.push(m);
    const w = this._waiter;
    if (w !== null) {
      this._waiter = null;
      w();
    }
  }

  finish(txStatus: string): void {
    this._txStatus = txStatus;
    this._done = true;
    const w = this._waiter;
    if (w !== null) {
      this._waiter = null;
      w();
    }
  }

  fail(err: PgError): void {
    this._err = err;
    this._done = true;
    const w = this._waiter;
    if (w !== null) {
      this._waiter = null;
      w();
    }
  }

  /**
   * Pop the next backend message, awaiting the stream. Returns null after
   * ReadyForQuery (or once the exchange failed and drained).
   */
  next(): Promise<Msg | null> {
    if (this._msgs.length > 0) {
      const m = this._msgs.shift();
      if (typeof m === "undefined") {
        return Promise.resolve(null);
      }
      return Promise.resolve(m);
    }
    if (this._done) {
      return Promise.resolve(null);
    }
    return new Promise<Msg | null>((resolve) => {
      this._waiter = () => {
        if (this._msgs.length > 0) {
          const m = this._msgs.shift();
          if (typeof m === "undefined") {
            resolve(null);
            return;
          }
          resolve(m);
          return;
        }
        resolve(null);
      };
    });
  }
}

export class PgSocket {
  _sock: Socket | null;
  _rx: Reader;
  _cur: Exchange | null;
  _tail: Promise<void>;
  _closed: boolean;
  _notices: PgError[];
  _notify: NotifyMsg[];
  _backendKey: BackendKey | null;
  _params: Record<string, string>;
  _lastTxStatus: string;
  _onFatal: ((err: PgError) => void) | null;

  constructor(sock: Socket) {
    this._sock = sock;
    this._rx = new Reader();
    this._cur = null;
    this._tail = Promise.resolve();
    this._closed = false;
    this._notices = [];
    this._notify = [];
    this._backendKey = null;
    this._params = {};
    this._lastTxStatus = "I";
    this._onFatal = null;
  }

  get closed(): boolean {
    return this._closed;
  }

  get backendKey(): BackendKey | null {
    return this._backendKey;
  }

  get txStatus(): string {
    return this._lastTxStatus;
  }

  param(name: string): string | null {
    const v = this._params[name];
    if (typeof v === "string") {
      return v;
    }
    return null;
  }

  /** TCP connect with timeout; wires the read dispatch. */
  static connect(host: string, port: number, timeoutMs: number): Promise<PgSocket> {
    return new Promise<PgSocket>((resolve, reject) => {
      let settled = false;
      const sock = createConnection({ host: host, port: port });
      sock.setNoDelay(true);
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        sock.destroy();
        reject(
          new PgError({
            code: "CONNECTION",
            message: "connect timed out after " + String(timeoutMs) + "ms",
            severity: "ERROR",
            detail: null,
            hint: null,
            position: null,
          }),
        );
      }, timeoutMs);
      sock.once("connect", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const pg = new PgSocket(sock);
        pg._wire();
        resolve(pg);
      });
      sock.once("error", (e: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(
          new PgError({
            code: "CONNECTION",
            message: "connect failed: " + e.message,
            severity: "ERROR",
            detail: null,
            hint: null,
            position: null,
          }),
        );
      });
    });
  }

  _wire(): void {
    const sock = this._sock;
    if (sock === null) {
      return;
    }
    sock.on("data", (chunk: Uint8Array) => {
      this._onData(chunk);
    });
    sock.on("error", (e: Error) => {
      this._fatal("socket error: " + e.message);
    });
    sock.on("close", () => {
      this._fatal("connection closed");
    });
  }

  _onData(chunk: Uint8Array): void {
    this._rx.feed(chunk);
    for (;;) {
      const m = this._rx.next();
      if (m === null) {
        return;
      }
      this._dispatch(m);
    }
  }

  _dispatch(m: Msg): void {
    if (m.type === B_NOTIFY) {
      this._notify.push(decodeNotify(m));
      return;
    }
    if (m.type === B_PARAM_STATUS) {
      const p = decodeParamStatus(m);
      this._params[p.name] = p.value;
      return;
    }
    if (m.type === B_NOTICE) {
      this._notices.push(new PgError(decodeErrorFields(m)));
      return;
    }
    if (m.type === B_BACKEND_KEY) {
      this._backendKey = { pid: m.i32(), secret: m.i32() };
      const cur = this._cur;
      if (cur !== null) {
        cur.push(m);
      }
      return;
    }
    if (m.type === B_READY) {
      const txb = m.u8();
      this._lastTxStatus = String.fromCharCode(txb);
      const cur = this._cur;
      if (cur !== null) {
        this._cur = null;
        cur.finish(this._lastTxStatus);
      }
      return;
    }
    const cur = this._cur;
    if (cur !== null) {
      cur.push(m);
    }
  }

  _fatal(msg: string): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    const cur = this._cur;
    this._cur = null;
    if (cur !== null) {
      cur.fail(
        new PgError({
          code: "CONNECTION",
          message: msg,
          severity: "FATAL",
          detail: null,
          hint: null,
          position: null,
        }),
      );
    }
    const f = this._onFatal;
    if (f !== null) {
      f(
        new PgError({
          code: "CONNECTION",
          message: msg,
          severity: "FATAL",
          detail: null,
          hint: null,
          position: null,
        }),
      );
    }
  }

  /** Write bytes to the socket. */
  send(bytes: Uint8Array): void {
    const s = this._sock;
    if (s === null) {
      throw new PgError({
        code: "CONNECTION",
        message: "connection is closed",
        severity: "ERROR",
        detail: null,
        hint: null,
        position: null,
      });
    }
    s.write(bytes);
  }

  /**
   * Single-flight: run `job` holding the exchange slot. Serializes all
   * protocol exchanges on this connection.
   */
  run<T>(job: (ex: Exchange) => Promise<T>): Promise<T> {
    const start = this._tail;
    let release: () => void = () => {};
    this._tail = new Promise<void>((r) => {
      release = r;
    });
    return start.then(() => {
      if (this._closed) {
        release();
        return Promise.reject(
          new PgError({
            code: "CONNECTION",
            message: "connection is closed",
            severity: "ERROR",
            detail: null,
            hint: null,
            position: null,
          }),
        );
      }
      const ex = new Exchange();
      this._cur = ex;
      return job(ex).then(
        (v) => {
          this._cur = null;
          release();
          return v;
        },
        (e) => {
          this._cur = null;
          release();
          throw e;
        },
      );
    });
  }

  /** Drain notifications received since the last call. */
  drainNotify(): NotifyMsg[] {
    const out = this._notify;
    this._notify = [];
    return out;
  }

  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    const s = this._sock;
    this._sock = null;
    const cur = this._cur;
    this._cur = null;
    if (cur !== null) {
      cur.fail(
        new PgError({
          code: "CONNECTION",
          message: "connection is closed",
          severity: "ERROR",
          detail: null,
          hint: null,
          position: null,
        }),
      );
    }
    if (s !== null) {
      s.destroy();
    }
  }
}
