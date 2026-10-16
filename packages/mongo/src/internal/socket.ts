// SocketChannel — the single serialized node:net / node:tls transport for
// OP_MSG. One request in flight per channel; callers (the session) run
// commands sequentially on the owned socket. A response read gathers the
// 4-byte length prefix then exactly messageLength bytes.

import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnectRaw } from "node:tls";
import { mongoError } from "../errors.ts";

/** Handle across the two socket types scriptc lowers (net.Socket covers
 * both under our connectivity matrix — MongoDB TLS is first-byte so a
 * tls.connect result is a Socket-shaped object). */
export class SocketChannel {
  sock: Socket | null;
  buf: Uint8Array;
  queued: Uint8Array;
  closed: boolean;
  err: Error | null;
  waiters: ((b: Uint8Array | null) => void)[];

  constructor() {
    this.sock = null;
    this.buf = new Uint8Array(0);
    this.queued = new Uint8Array(0);
    this.closed = false;
    this.err = null;
    this.waiters = [];
  }

  attach(sock: Socket): void {
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on("data", (chunk: Uint8Array) => {
      this.onData(chunk);
    });
    sock.on("error", (e: Error) => {
      this.err = e;
      this.failAll(e);
    });
    sock.on("close", () => {
      this.closed = true;
      this.failAll(mongoError("NetworkError", "socket closed"));
    });
    sock.on("timeout", () => {
      this.err = mongoError("NetworkError", "socket timed out");
      sock.destroy();
      this.failAll(this.err);
    });
  }

  onData(chunk: Uint8Array): void {
    const next = new Uint8Array(this.queued.length + chunk.length);
    next.set(this.queued, 0);
    next.set(chunk, this.queued.length);
    this.queued = next;
    this.pump();
  }

  pump(): void {
    if (this.waiters.length === 0) {
      return;
    }
    const want = this.peekNeeded();
    if (want < 0) {
      return;
    }
    if (this.queued.length < want) {
      return;
    }
    const cb = this.waiters.shift();
    if (cb !== null && typeof cb !== "undefined") {
      cb(this.queued.slice(0, want));
      this.queued = this.queued.slice(want);
    }
  }

  peekNeeded(): number {
    if (this.queued.length < 4) {
      return -1;
    }
    const dv = new DataView(this.queued.buffer, this.queued.byteOffset, this.queued.length);
    const want = dv.getInt32(0, true);
    return want;
  }

  failAll(err: Error): void {
    while (this.waiters.length > 0) {
      const cb = this.waiters.shift();
      if (cb !== null && typeof cb !== "undefined") {
        cb(null);
      }
    }
    if (err instanceof Error) {
      this.err = err;
    }
  }

  /** Read exactly one full OP_MSG frame (the next `want` bytes). */
  readFrame(timeoutMs: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.err !== null || this.closed) {
        reject(this.err !== null ? this.err : mongoError("NetworkError", "socket closed"));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(mongoError("NetworkError", "response read timed out"));
        }
      }, timeoutMs);
      this.waiters.push((b: Uint8Array | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (b === null) {
          reject(
            this.err !== null ? this.err : mongoError("NetworkError", "socket closed mid-read"),
          );
          return;
        }
        resolve(b);
      });
      this.pump();
    });
  }

  write(frame: Uint8Array): void {
    if (this.sock === null) {
      throw mongoError("NetworkError", "socket not connected");
    }
    this.sock.write(frame);
  }

  close(): void {
    if (this.sock !== null) {
      this.sock.destroy();
      this.sock = null;
    }
    this.closed = true;
    this.failAll(mongoError("NetworkError", "channel closed"));
  }
}

/** Connect a plain TCP channel. */
export function connectTcp(host: string, port: number, timeoutMs: number): Promise<SocketChannel> {
  return new Promise<SocketChannel>((resolve, reject) => {
    const ch = new SocketChannel();
    let settled = false;
    const sock = netConnect(port, host);
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      settled = true;
      sock.setTimeout(0);
      ch.attach(sock);
      resolve(ch);
    });
    sock.once("error", (e: Error) => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(e);
      }
    });
    sock.once("timeout", () => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(mongoError("NetworkError", "connect timed out"));
      }
    });
  });
}

/** Connect a TLS channel (first-byte TLS — Atlas/Cosmos default). */
export function connectTls(
  host: string,
  port: number,
  servername: string,
  rejectUnauthorized: boolean,
  timeoutMs: number,
): Promise<SocketChannel> {
  return new Promise<SocketChannel>((resolve, reject) => {
    const ch = new SocketChannel();
    let settled = false;
    const sock = tlsConnectRaw(port, host, {
      servername: servername,
      rejectUnauthorized: rejectUnauthorized,
    });
    sock.setTimeout(timeoutMs);
    sock.once("secureConnect", () => {
      settled = true;
      sock.setTimeout(0);
      ch.attach(sock as unknown as Socket);
      resolve(ch);
    });
    sock.once("error", (e: Error) => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(e);
      }
    });
    sock.once("timeout", () => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(mongoError("NetworkError", "tls connect timed out"));
      }
    });
  });
}
