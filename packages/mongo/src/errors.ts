// MongoError + error helpers for @cutils/mongo.
//
// Server errors carry the server's numeric `code` and string `codeName`
// ("DuplicateKey", ...). Client-side errors (network, protocol, auth,
// validation, misuse) carry `code: -1` and a named codeName so
// `err.codeName === "Validation"` / `"NetworkError"` style checks read the
// same as the sqlite/mcp packages' string codes.

export class MongoError extends Error {
  code: number;
  codeName: string;

  constructor(fields: { code: number; codeName: string; message: string }) {
    super(fields.message);
    this.name = "MongoError";
    this.code = fields.code;
    this.codeName = fields.codeName;
  }
}

/** Build a client-side MongoError (code -1). */
export function mongoError(codeName: string, message: string): MongoError {
  return new MongoError({ code: -1, codeName: codeName, message: message });
}

/** Client-side code -> codeName fallback for server errors that omit the
 * name (writeErrors entries do). Mirrors the official driver's table. */
export function codeNameFor(code: number): string {
  switch (code) {
    case 11000:
    case 11001:
    case 12582:
      return "DuplicateKey";
    case 50:
      return "ExceededTimeLimit";
    case 26:
      return "NamespaceNotFound";
    case 20:
      return "IllegalOperation";
    case 40:
      return "ConflictingUpdateOperators";
    case 51:
      return "UserNotFound";
    case 18:
      return "AuthenticationFailed";
    case 13:
      return "Unauthorized";
    case 121:
      return "DocumentValidationFailure";
    case 2:
      return "BadValue";
    case 9:
      return "FailedToParse";
    case 43:
      return "CursorNotFound";
    case 251:
      return "NoSuchTransaction";
    default:
      return "";
  }
}
