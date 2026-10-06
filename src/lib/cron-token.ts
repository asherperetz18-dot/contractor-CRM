/**
 * The bearer token a scheduled-job request carries (DECISIONS #140).
 * Pure, so the rules are tested apart from Next.js and the database.
 */
import { timingSafeEqual } from "node:crypto";

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec((header ?? "").trim());
  return match ? match[1] : null;
}

/** Whether two secrets match, in time that doesn't depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
