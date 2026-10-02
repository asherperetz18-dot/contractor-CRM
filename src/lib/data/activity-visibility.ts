import type { Profile } from "./types.ts";

type Flag = Pick<Profile, "is_super_admin">;

/**
 * Whether `viewer` may see `subject`'s activity -- page visits, time on
 * screen, who's online, which contacts they opened, the leads they
 * touched.
 *
 * A super admin's activity is seen by super admins only. Every other
 * viewer, an Admin included, sees no trace of it: not in Team Activity,
 * not in the online panel, not on a contact card's "Last opened by".
 * The database holds the same line (migration 0187), so a read straight
 * through the API is refused too, not just the screens.
 */
export function canSeeActivityOf(viewer: Flag | null, subject: Flag): boolean {
  return subject.is_super_admin !== true || viewer?.is_super_admin === true;
}
