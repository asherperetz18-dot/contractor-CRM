import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { financedBillingMessage } from "@/lib/payment-change";

/**
 * Which contracts are paying with financing (DECISIONS #166): those with
 * a signed payment change (0217) that hasn't been ended. Nothing bills or
 * reminds the customer for them, and their customer page asks for no
 * payment. Before 0217 has run, none.
 */

type Admin = ReturnType<typeof createAdminClient>;
/** The service client, or the signed-in person's (narrowed by their access). */
type Db = Admin | Awaited<ReturnType<typeof createClient>>;

/** The lender a contract is paying through, or null. */
export async function financedLender(admin: Admin, estimateId: string | null | undefined): Promise<string | null> {
  if (!estimateId) return null;
  const { data, error } = await admin
    .from("contract_payment_changes")
    .select("lender")
    .eq("estimate_id", estimateId)
    .eq("status", "signed")
    .limit(1)
    .maybeSingle<{ lender: string }>();
  if (error || !data) return null;
  return data.lender;
}

/** Every contract of the company paying with financing, by estimate id,
 *  with its lender. */
export async function financedContracts(admin: Db, companyId: string): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("contract_payment_changes")
    .select("estimate_id, lender")
    .eq("company_id", companyId)
    .eq("status", "signed")
    .returns<{ estimate_id: string; lender: string }[]>();
  if (error || !data) return new Map();
  return new Map(data.map((r) => [r.estimate_id, r.lender]));
}

/** Why a stage of this contract can't be billed, or null when it can. */
export async function financedBillingError(admin: Admin, estimateId: string | null | undefined): Promise<string | null> {
  const lender = await financedLender(admin, estimateId);
  return lender ? financedBillingMessage(lender) : null;
}
