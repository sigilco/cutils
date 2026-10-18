// CancelRequest: a fresh connection carrying the target backend's
// pid + secret. No auth, no reply — Postgres just closes it. Open, write
// 16 bytes, destroy.

import { createConnection } from "node:net";
import { encCancel } from "./messages.ts";
import { PgError } from "../errors.ts";

/**
 * @param {string} host
 * @param {number} port
 * @param {number} pid
 * @param {number} secret
 * @param {number} timeoutMs
 */
export function sendCancel(
  host: string,
  port: number,
  pid: number,
  secret: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const sock = createConnection({ host: host, port: port });
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      sock.destroy();
      reject(
        new PgError({
          code: "CONNECTION",
          message: "cancel request timed out",
          severity: "ERROR",
          detail: null,
          hint: null,
          position: null,
        }),
      );
    }, timeoutMs);
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve();
    };
    sock.once("connect", () => {
      // Single-arg write: `write(data, cb)` has no scriptc lowering (SC2020).
      // The request is fire-and-forget anyway — Postgres never replies.
      sock.write(encCancel(pid, secret));
      done();
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
          message: "cancel request failed: " + e.message,
          severity: "ERROR",
          detail: null,
          hint: null,
          position: null,
        }),
      );
    });
  });
}
