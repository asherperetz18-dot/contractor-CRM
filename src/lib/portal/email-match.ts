/**
 * The typed address as an ilike pattern that matches only itself.
 *
 * The portal sign-in form finds a customer case-insensitively, and to
 * ilike "_" and "%" are wildcards -- with underscores ordinary in email
 * addresses, "j_hn@example.com" would otherwise find john@example.com.
 */
export function exactEmailPattern(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}
