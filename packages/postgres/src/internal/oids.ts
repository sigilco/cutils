// Postgres type OID registry — the common OIDs, mapping wire type to a
// decoder for the TEXT result format (the only format v1 requests).
// Unknown OIDs decode as raw text. Arrays and composite types are v2.

export const OID_BOOL: number = 16;
export const OID_BYTEA: number = 17;
export const OID_CHAR: number = 18;
export const OID_NAME: number = 19;
export const OID_INT8: number = 20;
export const OID_INT2: number = 21;
export const OID_INT4: number = 23;
export const OID_TEXT: number = 25;
export const OID_OID: number = 26;
export const OID_JSON: number = 114;
export const OID_XML: number = 142;
export const OID_FLOAT4: number = 700;
export const OID_FLOAT8: number = 701;
export const OID_BPCHAR: number = 1042;
export const OID_VARCHAR: number = 1043;
export const OID_DATE: number = 1082;
export const OID_TIME: number = 1083;
export const OID_TIMESTAMP: number = 1114;
export const OID_TIMESTAMPTZ: number = 1184;
export const OID_INTERVAL: number = 1186;
export const OID_TIMETZ: number = 1266;
export const OID_NUMERIC: number = 1700;
export const OID_UUID: number = 2950;
export const OID_JSONB: number = 3802;
export const OID_INET: number = 869;
export const OID_CIDR: number = 650;
export const OID_MACADDR: number = 829;

/** Short type name for `columns().type`; null when the OID is unknown. */
export function oidName(oid: number): string | null {
  switch (oid) {
    case OID_BOOL:
      return "bool";
    case OID_BYTEA:
      return "bytea";
    case OID_CHAR:
      return "char";
    case OID_NAME:
      return "name";
    case OID_INT8:
      return "int8";
    case OID_INT2:
      return "int2";
    case OID_INT4:
      return "int4";
    case OID_TEXT:
      return "text";
    case OID_OID:
      return "oid";
    case OID_JSON:
      return "json";
    case OID_XML:
      return "xml";
    case OID_FLOAT4:
      return "float4";
    case OID_FLOAT8:
      return "float8";
    case OID_BPCHAR:
      return "bpchar";
    case OID_VARCHAR:
      return "varchar";
    case OID_DATE:
      return "date";
    case OID_TIME:
      return "time";
    case OID_TIMESTAMP:
      return "timestamp";
    case OID_TIMESTAMPTZ:
      return "timestamptz";
    case OID_INTERVAL:
      return "interval";
    case OID_TIMETZ:
      return "timetz";
    case OID_NUMERIC:
      return "numeric";
    case OID_UUID:
      return "uuid";
    case OID_JSONB:
      return "jsonb";
    case OID_INET:
      return "inet";
    case OID_CIDR:
      return "cidr";
    case OID_MACADDR:
      return "macaddr";
    default:
      return null;
  }
}

/** True when the OID decodes to a JS number. */
export function oidIsNumber(oid: number): boolean {
  return (
    oid === OID_INT2 ||
    oid === OID_INT4 ||
    oid === OID_OID ||
    oid === OID_FLOAT4 ||
    oid === OID_FLOAT8
  );
}
