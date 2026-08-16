/**
 * A return path from a query string, or null.
 *
 * These values arrive in URLs anyone can craft, so they are only ever
 * allowed to be a path inside this app. "//evil.com" and
 * "https://evil.com" are both rejected: a link that quietly forwards a
 * signed-in user off-site is an open redirect, and these ones are handed
 * out by the app's own screens.
 *
 * Shared rather than copied, because a second implementation is where
 * the "//" case gets forgotten.
 */
export function safeInternalPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
