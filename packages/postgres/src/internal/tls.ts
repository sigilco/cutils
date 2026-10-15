// TLS upgrade — currently a STUB.
//
// scriptc 0.3.3 lowers `node:net` but not `node:tls` socket clients
// (only `https.request` lowers today), so the SslRequest → TLS handshake
// path cannot compile. The option stays in `ConnectOpts` for API
// stability; `require` / `verify-full` throw PgError 0A000 here so the
// failure is explicit at connect time, not a silent downgrade.
//
// When the toolchain lowers `node:tls`, this file gains the upgrade:
// send encSslRequest(), expect a single 'S' byte, wrap the socket, then
// proceed to the StartupMessage.

import { PgError } from "../errors.ts";

export function assertSslSupported(ssl: string): void {
  if (ssl === "disable" || ssl === "") {
    return;
  }
  throw new PgError({
    code: "0A000",
    message: "TLS postgres connections are not supported in @cutils/postgres v1",
    severity: "ERROR",
    detail:
      'scriptc 0.3.3 does not lower node:tls sockets; ssl: "' +
      ssl +
      '" requires a lowered TLS client',
    hint: 'use ssl: "disable" against a local or private-network Postgres, or terminate TLS in front of the server',
    position: null,
  });
}
