/**
 * Where a stored file is opened from (DECISIONS #108).
 *
 * Job files, receipts and company documents used to be saved as
 * permanent public Supabase links: anyone holding one -- a forwarded
 * email, a former employee, a customer's browser history -- could open
 * the file for ever. They now live in private buckets and are saved as
 * an address inside the CRM, /api/files/<bucket>/<path>. That route
 * checks who is asking (api/files/[bucket]/[...path]/route.ts) and only
 * then redirects to a signed link that expires.
 *
 * Logos are not here: the portal shows one before a customer has signed
 * in, so they stay public.
 *
 * Pure, so it is tested on its own (file-url.test.ts).
 */

export const PRIVATE_FILE_BUCKETS = ["lead-files", "company-docs"] as const;
export type PrivateFileBucket = (typeof PRIVATE_FILE_BUCKETS)[number];

const PREFIX = "/api/files/";

/** The CRM address saved for an object -- what file_url / receipt_url hold. */
export function privateFileUrl(bucket: PrivateFileBucket, path: string): string {
  return PREFIX + bucket + "/" + path.split("/").map(encodeURIComponent).join("/");
}

/**
 * The bucket and object path a request names, or null when it names
 * nothing servable. Read from the raw pathname and decoded here, one
 * segment at a time, so a saved name with spaces, "&" or "(" comes back
 * exactly -- whether it was written by privateFileUrl or carried over
 * from an old public link by the migration.
 */
export function fileRouteTarget(pathname: string): { bucket: PrivateFileBucket; path: string } | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const bucket = rest.slice(0, slash);
  if (!(PRIVATE_FILE_BUCKETS as readonly string[]).includes(bucket)) return null;
  let segments: string[];
  try {
    segments = rest.slice(slash + 1).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("/"))) return null;
  return { bucket: bucket as PrivateFileBucket, path: segments.join("/") };
}
