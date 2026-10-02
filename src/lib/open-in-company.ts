/**
 * Where to land after switching company, always on this site: a path
 * that tries to leave it ("//host", a full URL) lands on the home page.
 */
export function companyUrl(path: string, origin: string): string {
  const url = new URL(path, origin);
  return url.origin === origin ? url.toString() : new URL("/", origin).toString();
}

/**
 * Finishes a company switch with a full page load.
 *
 * The switch itself only changes a cookie. A soft refresh re-renders the
 * server parts but keeps everything the browser already holds -- the
 * dialer's Twilio device most of all, which kept placing calls on the
 * previous company's account, so customers saw that company's number.
 * A full load starts every screen, and the dialer, from the new company
 * (DECISIONS #105).
 */
export function openInCompany(path = "/"): void {
  window.location.assign(companyUrl(path, window.location.origin));
}
