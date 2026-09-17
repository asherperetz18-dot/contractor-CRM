/**
 * What the portal login page says when a sign-in link didn't work.
 *
 * The verify route redirects a dead link to /portal?error=<why>, and the
 * page used to drop that param on the floor: a co-owner whose shared
 * link was already opened by the other owner (one email, one link --
 * DECISIONS #022) landed on the plain login form with no idea their
 * click had failed, or that typing their email right there is the fix.
 * The message says what happened; the hint points at the form below.
 */

export type LoginNotice = { message: string; hint: string };

const HINT = "Enter your email below and we'll send you a fresh link.";

export function portalLoginNotice(errorParam: string | null | undefined): LoginNotice | null {
  if (!errorParam) return null;
  // The verify route's own code for a link with no token at all.
  if (errorParam === "missing") {
    return { message: "That sign-in link didn't work.", hint: HINT };
  }
  return { message: errorParam, hint: HINT };
}
