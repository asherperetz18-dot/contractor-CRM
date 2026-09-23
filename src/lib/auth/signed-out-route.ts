// /home is the public front page: what the CRM does and what it costs.
// /portal is the customer-facing Client Portal. It runs on its own
// magic-link session (see lib/portal/session.ts), not Supabase Auth, so it
// must not be bounced to the staff login page.
// /get-started, /welcome and /register are the self-serve signup: whoever
// walks them has no account yet by definition, so bouncing them to the
// login page would close the only door in.
const PUBLIC_PATHS = [
  "/home",
  "/login",
  "/auth",
  "/portal",
  "/forgot-password",
  "/reset-password",
  "/get-started",
  "/welcome",
  "/register",
];

/**
 * Where a request with no staff session goes, or null to let it through.
 *
 * The bare address shows the front page rather than the login: a
 * contractor who types the site in should see the product before a
 * password box. Staff reach Sign in from its header in one click. Every
 * other private page still goes straight to the login.
 *
 * A public path matches whole segments, so a page that merely starts
 * with the same letters (/homework, /portalx) stays private.
 */
export function signedOutRedirect(pathname: string): string | null {
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
  if (isPublic) return null;
  return pathname === "/" ? "/home" : "/login";
}
