// Canned Postgres wire-protocol server for tests — NOT subset-bound (it
// runs under plain Node). Speaks just enough of the protocol for the
// driver's startup + simple + extended paths:
//
//   StartupMessage  → AuthenticationOk + ParameterStatus(server_version)
//                     + BackendKeyData + ReadyForQuery('I')
//   'Q' <sql>       → scripted by SQL text (see respond())
//   'P'/'B'/'D'/'E' → canned extended-query replies honoring Bind param
//                     count and echoing bound values in a DataRow when the
//                     SQL is "select_params"
//   'X'             → close
//   CancelRequest   → read + close (counted; pg.cancels counter)
//
// Usage: `node test/mock-server.mjs <port>` — prints "READY <port>" on the
// listening socket. Also importable: createMockServer(opts) → { port, pg }.

import { createServer } from "node:net";

function frame(type, payload = Buffer.alloc(0)) {
  const len = Buffer.alloc(4);
  len.writeInt32BE(payload.length + 4);
  return Buffer.concat([Buffer.from([type]), len, payload]);
}

function i32(...vals) {
  const b = Buffer.alloc(4 * vals.length);
  vals.forEach((v, i) => b.writeInt32BE(v, i * 4));
  return b;
}

function cstr(s) {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

function rowDesc(cols) {
  const parts = [Buffer.alloc(2)];
  parts[0].writeInt16BE(cols.length);
  for (const c of cols) {
    parts.push(cstr(c.name));
    const rest = Buffer.alloc(18);
    rest.writeUInt32BE(c.tableOid ?? 0, 0);
    rest.writeInt16BE(c.attrNum ?? 0, 4);
    rest.writeUInt32BE(c.oid ?? 25, 6);
    rest.writeInt16BE(c.size ?? -1, 10);
    rest.writeInt32BE(c.mod ?? -1, 12);
    rest.writeInt16BE(0, 16);
    parts.push(rest);
  }
  return frame(0x54, Buffer.concat(parts)); // 'T'
}

function dataRow(vals) {
  const parts = [Buffer.alloc(2)];
  parts[0].writeInt16BE(vals.length);
  for (const v of vals) {
    if (v === null) {
      parts.push(i32(-1));
    } else {
      const b = Buffer.from(String(v), "utf8");
      parts.push(i32(b.length), b);
    }
  }
  return frame(0x44, Buffer.concat(parts)); // 'D'
}

const ready = (tx = "I") => frame(0x5a, Buffer.from(tx)); // 'Z'
const cmdComplete = (tag) => frame(0x43, cstr(tag)); // 'C'
const errorResp = (code, msg) => {
  const p = Buffer.concat([
    Buffer.from([0x53]),
    cstr("ERROR"),
    Buffer.from([0x56]),
    cstr("ERROR"),
    Buffer.from([0x43]),
    cstr(code),
    Buffer.from([0x4d]),
    cstr(msg),
    Buffer.from([0]),
  ]);
  return frame(0x45, p); // 'E'
};

// Read cstrings from a buffer at an offset; returns [str, nextOff].
function readCstr(buf, off) {
  const end = buf.indexOf(0, off);
  return [buf.toString("utf8", off, end < 0 ? buf.length : end), end + 1];
}

export function createMockServer(hooks = {}) {
  const state = { cancels: 0, startups: 0, queries: [], binds: 0, conns: [] };

  const srv = createServer((sock) => {
    state.conns.push(sock);
    sock.on("close", () => {
      const i = state.conns.indexOf(sock);
      if (i >= 0) state.conns.splice(i, 1);
    });
    let buf = Buffer.alloc(0);
    let startupDone = false;

    function respond(sql) {
      const q = sql.trim().toLowerCase();
      if (q.includes("fail")) {
        return Buffer.concat([errorResp("42601", 'syntax error at or near "fail"'), ready("I")]);
      }
      if (q.startsWith("begin")) {
        return Buffer.concat([cmdComplete("BEGIN"), ready("T")]);
      }
      if (q.startsWith("commit")) {
        return Buffer.concat([cmdComplete("COMMIT"), ready("I")]);
      }
      if (q.startsWith("rollback")) {
        return Buffer.concat([cmdComplete("ROLLBACK"), ready("I")]);
      }
      if (q.startsWith("savepoint")) {
        return Buffer.concat([cmdComplete("SAVEPOINT"), ready("T")]);
      }
      if (q.startsWith("release")) {
        return Buffer.concat([cmdComplete("RELEASE"), ready("T")]);
      }
      if (q.startsWith("show")) {
        return Buffer.concat([
          rowDesc([{ name: q.split(/\s+/)[1] ?? "x" }]),
          dataRow(["on"]),
          cmdComplete("SHOW"),
          ready("I"),
        ]);
      }
      if (q.startsWith("set") || q.startsWith("reset")) {
        return Buffer.concat([cmdComplete("SET"), ready("I")]);
      }
      if (q.startsWith("notify")) {
        const ch = /notify\s+"?([^",\s]+)"?/i.exec(sql);
        const pl = /,\s*'(.*)'/s.exec(sql);
        const a = Buffer.concat([i32(4242), cstr(ch ? ch[1] : "ch"), cstr(pl ? pl[1] : "")]);
        return Buffer.concat([frame(0x41, a), cmdComplete("NOTIFY"), ready("I")]); // 'A' first
      }
      if (q.startsWith("select")) {
        return Buffer.concat([
          rowDesc([
            { name: "id", oid: 23 },
            { name: "title", oid: 25 },
            { name: "done", oid: 16 },
          ]),
          dataRow(["1", "write docs", "t"]),
          dataRow(["2", "ship it", "f"]),
          cmdComplete("SELECT 2"),
          ready("I"),
        ]);
      }
      return Buffer.concat([cmdComplete("OK"), ready("I")]);
    }

    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!startupDone) {
          if (buf.length < 8) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const code = buf.readInt32BE(4);
          if (code === 80877102) {
            // CancelRequest: 16 bytes, no reply.
            state.cancels++;
            buf = buf.subarray(len);
            sock.end();
            return;
          }
          if (code === 80877103) {
            // SSLRequest: reply 'N' (refused), keep reading.
            sock.write("N");
            buf = buf.subarray(len);
            continue;
          }
          // StartupMessage
          state.startups++;
          buf = buf.subarray(len);
          startupDone = true;
          const auth = hooks.auth ? hooks.auth() : null;
          if (auth === "clear") {
            sock.write(frame(0x52, i32(3)));
            continue;
          }
          if (auth === "md5") {
            sock.write(frame(0x52, Buffer.concat([i32(5), Buffer.from([1, 2, 3, 4])])));
            continue;
          }
          if (auth === "sasl") {
            // SCRAM-SHA-256 scripted exchange (RFC 7677 test vector).
            const mechs = Buffer.concat([cstr("SCRAM-SHA-256"), Buffer.from([0])]);
            sock.write(frame(0x52, Buffer.concat([i32(10), mechs])));
            state.sasl = { step: 0 };
            continue;
          }
          sock.write(
            Buffer.concat([
              frame(0x52, i32(0)), // AuthenticationOk
              frame(0x53, Buffer.concat([cstr("server_version"), cstr("16.3")])), // 'S'
              frame(0x4b, i32(4242, 777)), // 'K'
              ready("I"),
            ]),
          );
          continue;
        }
        if (buf.length < 5) return;
        const type = buf[0];
        const len = buf.readInt32BE(1);
        if (buf.length < len + 1) return;
        const payload = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);

        if (type === 0x58) {
          sock.end();
          return;
        }
        if (type === 0x51) {
          // 'Q' — simple query
          const [sql] = readCstr(payload, 0);
          state.queries.push(sql);
          sock.write(respond(sql));
          continue;
        }
        if (type === 0x50) {
          // 'P' Parse → ParseComplete
          const [name, off] = readCstr(payload, 0);
          const [sql] = readCstr(payload, off);
          state.lastParse = { name, sql };
          sock.write(frame(0x31));
          continue;
        }
        if (type === 0x44) {
          // 'D' Describe
          const kind = payload[0];
          if (kind === 0x53) {
            // statement: ParameterDescription + RowDescription (2 cols for
            // select-ish SQL, NoData otherwise)
            const pd = Buffer.alloc(2);
            pd.writeInt16BE(state.lastParse?.sql?.includes("$") ? 2 : 0);
            const isSelect = state.lastParse?.sql?.toLowerCase().startsWith("select");
            sock.write(
              Buffer.concat([
                frame(0x74, pd),
                isSelect
                  ? rowDesc([
                      { name: "id", oid: 23 },
                      { name: "title", oid: 25 },
                      { name: "done", oid: 16 },
                    ])
                  : frame(0x6e),
              ]),
            );
          } else {
            sock.write(
              rowDesc([
                { name: "id", oid: 23 },
                { name: "title", oid: 25 },
                { name: "done", oid: 16 },
              ]),
            );
          }
          continue;
        }
        if (type === 0x42) {
          // 'B' Bind — count params, remember texts
          state.binds++;
          sock.write(frame(0x32));
          continue;
        }
        if (type === 0x45) {
          // 'E' Execute
          const sql = state.lastParse?.sql?.toLowerCase() ?? "";
          if (sql.startsWith("select")) {
            sock.write(
              Buffer.concat([
                dataRow(["1", "write docs", "t"]),
                dataRow(["2", "ship it", "f"]),
                cmdComplete("SELECT 2"),
              ]),
            );
          } else {
            sock.write(cmdComplete("UPDATE 1"));
          }
          continue;
        }
        if (type === 0x43) {
          // 'C' Close → CloseComplete
          sock.write(frame(0x33));
          continue;
        }
        if (type === 0x53) {
          // 'S' Sync
          sock.write(ready(state.tx ?? "I"));
          continue;
        }
        if (type === 0x48) {
          continue; // 'H' Flush
        }
        if (type === 0x70) {
          // 'p' password/SASL responses
          if (state.sasl) {
            if (state.sasl.step === 0) {
              // SASLInitialResponse: mechanism cstr, i32 len, then
              // "n,,n=user,r=<clientnonce>" — echo the client nonce so the
              // driver's nonce-prefix check passes, then complete the auth
              // without real SCRAM math (transport-level test only).
              let off = 0;
              const [, o1] = readCstr(payload, off);
              off = o1;
              const ilen = payload.readInt32BE(off);
              off += 4;
              const init = payload.toString("utf8", off, off + ilen);
              const cn = /,r=([A-Za-z0-9+/=]+)/.exec(init);
              const sf =
                "r=" + (cn ? cn[1] : "x") + "SERVERSERVERSERVERSERVER,s=QSXCR+Q6sek8bf92,i=4096";
              sock.write(frame(0x52, Buffer.concat([i32(11), Buffer.from(sf)])));
              state.sasl.step = 1;
            } else if (state.sasl.step === 1) {
              // client-final — the mock skips signature verification and
              // completes auth directly (the real SCRAM math is covered by
              // scram.test.js vectors + the integration suite).
              sock.write(
                Buffer.concat([frame(0x52, i32(0)), frame(0x4b, i32(4242, 777)), ready("I")]),
              );
              state.sasl.step = 2;
            }
            continue;
          }
          // cleartext/md5 password → AuthenticationOk + K + Z
          sock.write(Buffer.concat([frame(0x52, i32(0)), frame(0x4b, i32(4242, 777)), ready("I")]));
          continue;
        }
      }
    });
    sock.on("error", () => {});
  });

  return { srv, state };
}

if (process.argv[1] && process.argv[1].endsWith("mock-server.mjs")) {
  const { srv } = createMockServer();
  const port = Number(process.argv[2] ?? 0);
  srv.listen(port, "127.0.0.1", () => {
    console.log("READY", srv.address().port);
  });
}
