import type { QbEnvironment } from "./oauth.ts";

/**
 * Whether a connection was made on the other side of Intuit from where the
 * CRM now sends (DECISIONS #192). Its login was given to the other side's
 * app, so nothing goes: screens treat it as not connected. False while
 * QuickBooks isn't set up on the CRM (nothing to compare with).
 */
export function onOtherSide(environment: string | null | undefined, crm: QbEnvironment | null | undefined): boolean {
  return !!crm && !!environment && environment !== crm;
}

/**
 * A connection made on the other side of Intuit (DECISIONS #192): to a
 * practice company while the CRM now sends to real books, or the other way
 * round. Its login was given to the other side's app, so nothing goes
 * until the company connects again, and Settings has to say so instead of
 * "Connected". Null when the connection is on the CRM's side, when there is
 * none, or while QuickBooks isn't set up on the CRM (`crm` null).
 */
export function otherSideNote(
  connection: { connected: boolean; environment: QbEnvironment } | null,
  crm: QbEnvironment | null
): string | null {
  if (!connection?.connected || !onOtherSide(connection.environment, crm)) return null;
  return crm === "production"
    ? "This is Intuit's practice company. The CRM now sends to real QuickBooks companies, so nothing goes to QuickBooks until you connect your real company: click Connect again."
    : "This is a real QuickBooks company, but the CRM is set to Intuit's practice companies right now, so nothing goes to QuickBooks. Connecting again to a practice company clears what's picked for this one, so only do that if you mean to.";
}
