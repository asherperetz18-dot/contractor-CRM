/**
 * The names a company gives its team roles (DECISIONS #138).
 *
 * A remodeler's "Sales" are an HVAC company's "Technicians"; one company's
 * "Call Center" is another's "Front Desk". Each company can rename the
 * roles it shows in Settings › Users & Roles (company_profile.role_names,
 * migration 0202). Only what people read changes: every permission, page
 * rule and saved assignment still uses the role itself ("Sales"), so a
 * rename can never give anyone more or less access.
 *
 * Pure: no database, no Next.js -- the settings page, the server and the
 * tests all read it. A missing or broken saved name reads as the standard
 * one, so a role never shows up blank.
 */
import { APP_ROLES, type AppRole } from "./data/types.ts";

export type RoleNames = Record<AppRole, string>;

/** The standard names: the roles themselves. */
export const STANDARD_ROLE_NAMES: RoleNames = Object.fromEntries(APP_ROLES.map((r) => [r, r])) as RoleNames;

/**
 * Admin and Office keep their names. They are the roles that run the
 * company's settings, and the app's messages name them everywhere ("ask
 * an Office or Admin user", "Office or Admin only"); renamed, all of
 * those would disagree with the screen.
 */
export const FIXED_ROLES: readonly AppRole[] = ["Admin", "Office"];

export const RENAMEABLE_ROLES: readonly AppRole[] = APP_ROLES.filter((r) => !FIXED_ROLES.includes(r));

export const MAX_ROLE_NAME_LENGTH = 30;

// The same plain characters as company words: letters, digits, spaces and
// a little punctuation -- no markup, links or emoji.
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 '&-]*$/;

/** Why a typed role name can't be saved, or null. */
export function roleNameProblem(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return "Type a name.";
  if (name.length > MAX_ROLE_NAME_LENGTH) return `Keep it to ${MAX_ROLE_NAME_LENGTH} characters.`;
  if (!PLAIN_NAME.test(name)) return "Use letters, numbers, spaces, hyphens, apostrophes or &.";
  return null;
}

/** A company's role names: what it saved, the standard name for anything missing, broken or fixed. */
export function readRoleNames(stored: unknown): RoleNames {
  const saved = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out = { ...STANDARD_ROLE_NAMES };
  for (const role of RENAMEABLE_ROLES) {
    const value = saved[role];
    if (roleNameProblem(value)) continue;
    out[role] = String(value).trim();
  }
  // Two roles reading the same would make them impossible to tell apart;
  // a stored clash (edited by hand) falls back to the standard names.
  return duplicateName(out) ? { ...STANDARD_ROLE_NAMES } : out;
}

function duplicateName(names: RoleNames): string | null {
  const seen = new Map<string, AppRole>();
  for (const role of APP_ROLES) {
    const key = names[role].toLowerCase();
    const first = seen.get(key);
    if (first) return names[first];
    seen.set(key, role);
  }
  return null;
}

/**
 * What a save stores: only the names that differ from the standard ones,
 * trimmed; a blank name goes back to the standard one. The first problem
 * found stops the save.
 */
export function storedRoleNames(
  input: Partial<Record<string, unknown>>
): { names: Partial<Record<AppRole, string>> } | { error: string } {
  const names: Partial<Record<AppRole, string>> = {};
  const all = { ...STANDARD_ROLE_NAMES };
  for (const role of RENAMEABLE_ROLES) {
    if (!(role in input)) continue;
    // Left blank: back to the standard name.
    if (typeof input[role] !== "string" || !String(input[role]).trim()) continue;
    const problem = roleNameProblem(input[role]);
    if (problem) return { error: `${role}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` };
    const name = String(input[role]).trim();
    all[role] = name;
    if (name !== role) names[role] = name;
  }
  const clash = duplicateName(all);
  if (clash) return { error: `Two roles can't both be called "${clash}".` };
  return { names };
}

/** A role as this company names it. */
export function roleName(names: RoleNames | null | undefined, role: AppRole): string {
  return names?.[role] ?? STANDARD_ROLE_NAMES[role];
}

/** A list of roles as this company names them, joined for a sentence or a cell. */
export function roleNamesList(names: RoleNames | null | undefined, roles: readonly AppRole[], joiner = ", "): string {
  return roles.map((r) => roleName(names, r)).join(joiner);
}
