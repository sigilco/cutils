// Transaction state: lsid (random 16-byte id doc), monotonically increasing
// txnNumber, inTransaction flag. Command fields (lsid/txnNumber/
// startTransaction/autocommit) are stamped by the Transaction itself; the
// first command after begin carries startTransaction:true.

import { randomBytes } from "node:crypto";
import type { BsonDoc } from "../bson/value.ts";
import { vBin } from "../bson/value.ts";

export class TxnState {
  lsid: BsonDoc;
  txnNumber: number;
  started: boolean;
  active: boolean;

  constructor() {
    this.lsid = {};
    this.txnNumber = 0;
    this.started = false;
    this.active = false;
    const id: BsonDoc = {};
    id["id"] = vBin(randomBytes(16), 4);
    this.lsid = id;
  }

  begin(): void {
    this.txnNumber = this.txnNumber + 1;
    this.started = true;
    this.active = true;
  }

  end(): void {
    this.active = false;
  }
}
