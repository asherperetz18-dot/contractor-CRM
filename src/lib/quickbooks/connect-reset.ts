import type { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchemaError } from "../schema-drift.ts";
import type { QbEnvironment } from "./oauth.ts";

type Admin = ReturnType<typeof createAdminClient>;

const STOPPED =
  "QuickBooks wasn't connected: the CRM couldn't finish clearing the settings picked for your previous QuickBooks company, so sending there may already be off. Please try connecting again.";

/**
 * Connecting a different QuickBooks company than before, or one on the
 * other side of Intuit (a real company where a practice one was): every
 * pick made for the old one is cleared before the new login is saved
 * (DECISIONS #173, #184, #192, #199). Sending bills, invoices and job costs
 * stops first, each switch together with the picks made for it (invoices'
 * products and accounts, the bank account lender payouts land in), so
 * nothing goes while the picks are half cleared; then the "paid from"
 * matches and the cost accounts go. What went to the old company stays
 * recorded under its id. `cleared` says it happened, so Settings can say
 * sending is off.
 *
 * Any read or write that fails stops the connection with an error: the old
 * company's accounts must never be sent to the new one. The old connection
 * stays connected, but whatever was already cleared stays cleared (bills
 * off first, then invoices with their picks, then job costs with theirs,
 * then the matches). Each step is safe to repeat, so connecting the new
 * company again finishes the job.
 */
export async function clearForNewCompany(
  admin: Admin,
  companyId: string,
  next: { realmId: string; environment: QbEnvironment }
): Promise<{ error?: string; cleared?: boolean }> {
  const { data: before, error: readError } = await admin
    .from("quickbooks_connections")
    .select("realm_id, environment")
    .eq("company_id", companyId)
    .maybeSingle<{ realm_id: string | null; environment: string | null }>();
  // Before 0221 there is nothing to clear; saving the login then says to run it.
  if (readError) return isMissingSchemaError(readError) ? {} : { error: STOPPED };
  if (!before?.realm_id || (before.realm_id === next.realmId && before.environment === next.environment)) return {};

  // Before 0222 there's no bills switch to turn off.
  const bills = await admin.from("quickbooks_connections").update({ send_bills: false, send_bills_from: null }).eq("company_id", companyId);
  if (bills.error && !isMissingSchemaError(bills.error)) return { error: STOPPED };
  // Its products and accounts were the old company's. Before 0227 these columns don't exist; nothing to clear then.
  const invoices = await admin
    .from("quickbooks_connections")
    .update({
      send_invoices: false,
      send_invoices_from: null,
      invoice_item_id: null,
      deposit_item_id: null,
      cost_item_id: null,
      payments_account_id: null,
      stripe_refunds_account_id: null,
      hand_refunds_account_id: null,
      items: null,
      items_read_at: null,
      qb_prefs: null,
    })
    .eq("company_id", companyId);
  if (invoices.error && !isMissingSchemaError(invoices.error)) return { error: STOPPED };
  // Job costs' switch and the bank account lender payouts land in were the old company's. Before 0230 there's nothing to clear.
  const costs = await admin
    .from("quickbooks_connections")
    .update({ send_costs: false, send_costs_from: null, lender_payouts_account_id: null })
    .eq("company_id", companyId);
  if (costs.error && !isMissingSchemaError(costs.error)) return { error: STOPPED };
  const paidFrom = await admin.from("payment_accounts").update({ qb_account_id: null }).eq("company_id", companyId);
  if (paidFrom.error) return { error: STOPPED };
  const matches = await admin.from("quickbooks_expense_accounts").delete().eq("company_id", companyId);
  if (matches.error) return { error: STOPPED };
  return { cleared: true };
}
