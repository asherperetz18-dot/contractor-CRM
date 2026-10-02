/**
 * Whether a Google sign-in's callback may save a connection for the
 * target its cookie names.
 *
 * The authorize routes write the target (company, and the person for a
 * rep's own calendar) into a short-lived cookie because the callback is a
 * separate request. A cookie is the browser's to edit, so the callback
 * holds it to the signed-in person: same company, and either their own
 * calendar or -- for a company-wide connection -- Office or Admin. The
 * Facebook callback has always checked this way (meta/callback).
 */
export function oauthTargetAllowed(
  profile: { id: string; company_id: string; isAdmin: boolean } | null,
  target: { company_id: string; profile_id: string | null }
): boolean {
  if (!profile || profile.company_id !== target.company_id) return false;
  return target.profile_id ? target.profile_id === profile.id : profile.isAdmin;
}
