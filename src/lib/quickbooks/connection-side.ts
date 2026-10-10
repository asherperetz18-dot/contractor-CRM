import type { QbEnvironment } from "./oauth.ts";

/**
 * A connection made on the other side of Intuit (DECISIONS #192): to a
 * practice company while the CRM now sends to real books, or the other way
 * round. Its login was given to the other side's app, so nothing goes
 * until the company connects again, and Settings has to say so instead of
 * "Connected". Null when the connection is on the CRM's side, or there is
 * none.
 */
export function otherSideNote(
  connection: { connected: boolean; environment: QbEnvironment } | null,
  crm: QbEnvironment
): string | null {
  if (!connection?.connected || connection.environment === crm) return null;
  return crm === "production"
    ? "This is Intuit's practice company. The CRM now sends to real QuickBooks companies, so nothing goes to QuickBooks until you connect your real company: click Connect again."
    : "This is a real QuickBooks company, but the CRM is set to Intuit's practice companies right now, so nothing goes to QuickBooks. Connect again to use a practice company.";
}
