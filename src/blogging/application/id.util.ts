/** Loose UUID shape check — keeps malformed path params out of Prisma
 * (`@db.Uuid` columns would otherwise surface a driver error as 500).
 * A malformed id is semantically "not found", never "server broke". */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
