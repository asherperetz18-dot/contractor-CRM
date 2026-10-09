import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { oauthTargetAllowed } from "@/lib/oauth-target";
import { encryptSecret } from "@/lib/crypto/secrets";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { exchangeQuickBooksCode, qbApiBase, quickbooksCredentials } from "@/lib/quickbooks/oauth";
import { readQbAccounts, readQbCompanyName } from "@/lib/quickbooks/connection";
import { suggestPaymentMatch } from "@/lib/quickbooks/accounts";
import { readItems } from "@/lib/quickbooks/api";

/**
 * Intuit sends the person back here with a code for the QuickBooks
 * company they picked (DECISIONS #172). The code becomes a login, kept
 * encrypted; the company's name and its accounts are read; and "paid
 * from" accounts whose QuickBooks account is clear are matched. Nothing
 * is written to QuickBooks.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const realmId = params.get("realmId");
  const expectedState = req.cookies.get("qb_oauth_state")?.value;
  const targetRaw = req.cookies.get("qb_oauth_target")?.value;

  const settingsUrl = new URL("/settings/quickbooks", req.url);
  const done = (error?: string) => {
    if (error) settingsUrl.searchParams.set("error", error);
    else settingsUrl.searchParams.set("connected", "1");
    const res = NextResponse.redirect(settingsUrl);
    res.cookies.delete("qb_oauth_state");
    res.cookies.delete("qb_oauth_target");
    return res;
  };

  if (params.get("error")) return done("QuickBooks wasn't connected: the sign-in was cancelled.");
  let target: { company_id?: string } | null = null;
  try {
    target = targetRaw ? JSON.parse(targetRaw) : null;
  } catch {
    target = null;
  }
  if (!code || !realmId || !state || !expectedState || state !== expectedState || !target?.company_id) {
    return done("The QuickBooks sign-in didn't match. Please try connecting again.");
  }
  // The cookie's company must be the signed-in person's own, and they
  // must be Office or Admin: a cookie is the browser's to edit.
  const profile = await getCurrentProfile();
  const viewer = profile && { id: profile.id, company_id: profile.company_id, isAdmin: isAdminRole(profile) };
  if (!profile || !oauthTargetAllowed(viewer, { company_id: target.company_id, profile_id: null })) {
    return done("That QuickBooks sign-in doesn't match your account. Please try connecting again.");
  }
  const companyId = profile.company_id;

  const creds = quickbooksCredentials();
  if (!creds) return done("QuickBooks isn't set up on the CRM yet.");
  const exchanged = await exchangeQuickBooksCode({
    fetchImpl: fetch,
    creds,
    code,
    redirectUri: `${req.nextUrl.origin}/api/oauth/quickbooks/callback`,
    now: new Date(),
  });
  if ("error" in exchanged) return done(exchanged.error);
  const tokens = exchanged.tokens;
  const accessEnc = encryptSecret(tokens.accessToken);
  const refreshEnc = encryptSecret(tokens.refreshToken);
  if (!accessEnc || !refreshEnc) return done("The CRM's encryption key isn't set, so it can't keep a QuickBooks login.");

  // Read only: the company's name and its accounts.
  const access = { realmId, accessToken: tokens.accessToken, apiBase: qbApiBase(creds.environment) };
  const [companyName, accountsRead] = await Promise.all([readQbCompanyName(access), readQbAccounts(access)]);
  const accounts = "accounts" in accountsRead ? accountsRead.accounts : [];

  const admin = createAdminClient();
  // A different QuickBooks company than before: the old matches are its
  // accounts, not this one's.
  const { data: before } = await admin
    .from("quickbooks_connections")
    .select("realm_id")
    .eq("company_id", companyId)
    .maybeSingle<{ realm_id: string | null }>();
  if (before?.realm_id && before.realm_id !== realmId) {
    await admin.from("payment_accounts").update({ qb_account_id: null }).eq("company_id", companyId);
    await admin.from("quickbooks_expense_accounts").delete().eq("company_id", companyId);
    // Sending bills stops until the owner picks where the new books start
    // (DECISIONS #173); what went to the old company stays recorded under it.
    await admin.from("quickbooks_connections").update({ send_bills: false, send_bills_from: null }).eq("company_id", companyId);
    // The same for invoices (#184), and its picks were the old company's products and accounts.
    // Before 0227 these columns don't exist; nothing to reset then.
    await admin
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
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("quickbooks_connections").upsert(
    {
      company_id: companyId,
      realm_id: realmId,
      company_name: companyName,
      environment: creds.environment,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      access_expires_at: tokens.accessExpiresAt,
      refresh_expires_at: tokens.refreshExpiresAt,
      accounts,
      accounts_read_at: "accounts" in accountsRead ? now : null,
      connected_by: profile.id,
      connected_at: now,
      disconnected_at: null,
      last_error: "error" in accountsRead ? accountsRead.error : null,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );
  if (error) {
    return done(
      isMissingSchemaError(error)
        ? "QuickBooks needs a database update first: run 0221_quickbooks_connection.sql in Supabase, then connect again."
        : error.message
    );
  }

  // Its products and services, for invoices (#184); kept once 0227 has run.
  const items = await readItems(access);
  if (!("error" in items)) {
    await admin.from("quickbooks_connections").update({ items: items.items, items_read_at: now }).eq("company_id", companyId);
  }

  // "Paid from" accounts whose QuickBooks account is clear, matched now;
  // the rest are picked on the settings page.
  const { data: paidFrom } = await admin
    .from("payment_accounts")
    .select("id, name, kind, last4")
    .eq("company_id", companyId)
    .is("qb_account_id", null)
    .is("archived_at", null)
    .returns<{ id: string; name: string; kind: string; last4: string | null }[]>();
  for (const a of paidFrom ?? []) {
    const match = suggestPaymentMatch(a, accounts);
    if (match) await admin.from("payment_accounts").update({ qb_account_id: match }).eq("id", a.id).eq("company_id", companyId);
  }
  return done();
}
