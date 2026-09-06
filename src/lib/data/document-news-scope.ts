// The .ts extension keeps this runnable under node --test alongside its
// test file; the bundler resolves it the same as the bare name.
import { isAdminRole, type AppRole } from "./types.ts";

/**
 * Whether document news -- "customer opened a proposal", "signed!" --
 * should be limited to the documents assigned to this person.
 *
 * The bell and the popups compute their feeds from the same tables, and
 * both used to hand every estimate view and signature to anyone who
 * could view estimates at all. For a sales rep that is somebody else's
 * customer opening somebody else's proposal, forty times over: noise
 * that buries the one view that IS theirs.
 *
 * Company-wide stays company-wide for the roles whose job is the whole
 * company: Office and Admin run it, Bookkeeping reconciles all of its
 * money, Production runs every sold job. Everyone else -- Sales, Field
 * -- gets the documents where estimates.assigned_to is them, which is
 * the same field that decides who the "it was just signed" email goes
 * to. One notion of "the rep on this document", not two.
 */
export function seesOnlyOwnDocuments(profile: { roles: AppRole[] } | null): boolean {
  if (!profile) return true;
  if (isAdminRole(profile)) return false;
  if (profile.roles.includes("Bookkeeping")) return false;
  if (profile.roles.includes("Production")) return false;
  return true;
}
