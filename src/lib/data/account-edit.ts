/**
 * Who may change a person's account -- name, phone, sign-in email,
 * password -- from Settings → Users & Roles.
 *
 * The account is the person's, not one company's: the same login can work
 * in several companies, and its phone is where every one of them texts
 * that person. So an Office or Admin user may change it only when every
 * company the person works in is one they run as well. Without that, one
 * company could add another company's rep to itself and then reset their
 * password or point their texts at a different phone.
 *
 * Pure so the rule is tested on its own (account-edit.test.ts);
 * updateUserProfile in lib/actions/users.ts supplies the rows.
 */

export type AccountMembership = {
  company_id: string;
  /** Rows made only because the person is a platform admin (0132). */
  granted_via_platform_admin?: boolean | null;
  status?: string | null;
};

export const ACCOUNT_NOT_IN_COMPANY = "That person isn't in this company.";
export const ACCOUNT_PROTECTED = "This account is protected and can't be changed from here.";
export const ACCOUNT_SHARED =
  "This person also works for another company, so only they can change their account. They can reset their own password with \"Forgot password\" on the sign-in page.";

export function accountEditBlock(input: {
  actorId: string;
  targetId: string;
  /** The company the editor is working in right now. */
  companyId: string;
  /** Companies where the editor is an Active Office or Admin. */
  actorAdminCompanyIds: string[];
  /** Every membership row the person holds, Active or Archived. */
  targetMemberships: AccountMembership[];
  /** is_platform_admin or is_super_admin. */
  targetIsProtected: boolean;
}): string | null {
  if (input.actorId === input.targetId) return null;
  if (input.targetIsProtected) return ACCOUNT_PROTECTED;

  const real = input.targetMemberships.filter((m) => m.granted_via_platform_admin !== true);
  if (!real.some((m) => m.company_id === input.companyId)) return ACCOUNT_NOT_IN_COMPANY;

  // Archived seats count: an archived rep can be switched back on, and
  // would come back with whatever login this company set for them.
  const runsAll = real.every((m) => input.actorAdminCompanyIds.includes(m.company_id));
  return runsAll ? null : ACCOUNT_SHARED;
}
