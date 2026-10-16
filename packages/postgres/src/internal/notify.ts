// LISTEN/NOTIFY helpers. NotificationResponse messages are dispatched
// socket-side into a queue that `Database.notify()` drains — v1 has no
// long-lived LISTEN consumer (v2 ticket); users `exec("LISTEN ch")` and
// drain via notify().

/** Escape a single-quoted SQL string literal. */
export function sqlQuoteString(s: string): string {
  return "'" + s.split("'").join("''") + "'";
}

/** Escape a double-quoted SQL identifier. */
export function sqlQuoteIdent(s: string): string {
  return '"' + s.split('"').join('""') + '"';
}

/** `NOTIFY channel, 'payload'` as a simple query. */
export function notifySql(channel: string, payload: string): string {
  return "NOTIFY " + sqlQuoteIdent(channel) + ", " + sqlQuoteString(payload);
}
