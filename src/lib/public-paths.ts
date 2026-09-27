// /portal is the customer-facing Client Portal. It runs on its own
// magic-link session (see lib/portal/session.ts), not Supabase Auth, so it
// must not be bounced to the staff login page.
// /get-started, /welcome and /register are the self-serve signup: whoever
// walks them has no account yet by definition, so bouncing them to the
// login page would close the only door in.
// /privacy and /delete-account are linked from the Google Play listing,
// where reviewers and the public open them without an account.
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/portal",
  "/forgot-password",
  "/reset-password",
  "/get-started",
  "/welcome",
  "/register",
  "/privacy",
  "/delete-account",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}
