/**
 * The password rule, in one place.
 *
 * Two forms set a password on an account -- the reset link and the paid
 * signup link -- and they were each carrying their own copy of the length
 * check and the wording. Raising the minimum in one of them would have
 * left the other still accepting eight characters and still telling
 * people eight was enough, and the lenient one is the form that creates
 * company owners.
 *
 * A plain module rather than a helper inside actions/auth.ts: that file
 * is "use server", where every export has to be an async server action.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
