// mock-server.mjs — canned OP_MSG wire server (plain Node, not subset).
// Powers wire smoke tests + the consumer ELF smoke. Canned mongod: replies
// to `hello` with version/maxWireVersion, to `find`/`aggregate` with a
// single-document firstBatch and cursor id 0 (so no getMore), to
// `killCursors` and `endSessions` with ok:1. Auth is scriptable the same
// way as postgres's mock (createMockServer) but the ELF smoke runs
// unauthenticated.
//
// Usage: node test/mock-server.mjs <port>   (port 0 = ephemeral)
// Prints "READY <port>" once listening; logs each $db-qualified command.

import { createServer } from "node:net";
import { decodeDoc, encodeDoc } from "../dist/esm/internal/bson.js";
import { decodeMsg, encodeMsg, DocSeq } from "../dist/esm/internal/opmsg.js";
import { vI32, vI64Raw, vStr, vArr, vObj, vBool } from "../dist/esm/bson/value.js";

/** Reply body for one command, or null to fall through to ok:1. */
function replyFor(cmd) {
  if (cmd.hello !== undefined || cmd.ismaster !== undefined) {
    return {
      ok: vI32(1),
      helloOk: vBool(true),
      isWritablePrimary: vBool(true),
      primary: vStr("mock:27017"),
      maxBsonObjectSize: vI32(16777216),
      maxMessageSizeBytes: vI32(48000000),
      maxWriteBatchSize: vI32(100000),
      version: vStr("8.0.0"),
      maxWireVersion: vI32(25),
      minWireVersion: vI32(0),
    };
  }
  if (cmd.find !== undefined || cmd.aggregate !== undefined) {
    const doc = {
      _id: vStr("mock-1"),
      title: vStr("from-mock"),
      done: vBool(false),
      n: vI32(5),
    };
    return {
      ok: vI32(1),
      cursor: vObj({
        id: vI64Raw(BigInt(0)),
        ns: vStr(cmd.$db + "." + (cmd.find ?? cmd.aggregate)),
        firstBatch: vArr([vObj(doc)]),
      }),
    };
  }
  return null;
}

let nextId = 100;

export function createMockServer(onCommand) {
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 16) {
        const len = buf.readInt32LE(0);
        if (buf.length < len) break;
        const frame = buf.subarray(0, len);
        buf = buf.subarray(len);
        const msg = decodeMsg(new Uint8Array(frame));
        const cmd = {};
        for (const k of Object.keys(msg.body)) cmd[k] = plain(msg.body[k]);
        for (const s of msg.seqs) cmd[s.name] = s.docs.map((d) => plain(vObj(d)));
        let body = replyFor(cmd);
        if (body === null) {
          if (onCommand) onCommand(cmd);
          body = { ok: vI32(1) };
        }
        // encodeMsg emits the complete frame (header included); patch its
        // requestId/responseTo in place rather than wrapping again.
        const resp = encodeMsg(0, body, []);
        nextId = nextId + 1;
        resp[4] = nextId & 0xff;
        resp[5] = (nextId >> 8) & 0xff;
        resp[6] = (nextId >> 16) & 0xff;
        resp[7] = (nextId >> 24) & 0xff;
        resp[8] = msg.requestId & 0xff;
        resp[9] = (msg.requestId >> 8) & 0xff;
        resp[10] = (msg.requestId >> 16) & 0xff;
        resp[11] = (msg.requestId >> 24) & 0xff;
        sock.write(Buffer.from(resp));
      }
    });
    sock.on("error", () => {});
  });
  return server;
}

// BsonValue -> plain JS for the canned matcher. Only what the mock matches
// on; unknown arms come back as null.
function plain(v) {
  if (v === null || v === undefined) return null;
  switch (v.kind) {
    case "object":
      return docPlain(v.v);
    case "array":
      return v.v.map(plain);
    case "string":
      return v.v;
    case "int32":
      return v.v;
    case "int64":
      return v.raw ?? BigInt(v.v);
    case "boolean":
      return v.v;
    case "double":
      return v.v;
    default:
      return null;
  }
}

function docPlain(doc) {
  const out = {};
  for (const k of Object.keys(doc)) out[k] = plain(doc[k]);
  return out;
}

const port = Number(process.argv[2] ?? "0");
if (process.argv[1] && process.argv[1].endsWith("mock-server.mjs")) {
  const srv = createMockServer();
  srv.listen(port, "127.0.0.1", () => {
    console.log("READY", srv.address().port);
  });
}
