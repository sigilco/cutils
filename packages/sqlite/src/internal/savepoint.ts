// Savepoint name generation for nested transactions.
// Names must satisfy the shim's identifier whitelist [A-Za-z0-9_].

let counter: number = 0;

export function nextSavepoint(): string {
  counter += 1;
  return "sp_" + String(counter);
}
