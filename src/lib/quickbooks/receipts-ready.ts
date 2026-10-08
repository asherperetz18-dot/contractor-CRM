import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const NO_COMPANY = "00000000-0000-0000-0000-000000000000";

/** 0223 never goes away: once seen, not asked again by this server. */
let seenReady = false;

/**
 * Has 0223 run, so the CRM can record which receipt it attached in
 * QuickBooks (DECISIONS #174)? Asked by writing a receipt row for no
 * company: the database refuses it either way, and which rule refuses it
 * tells -- the record-type check before 0223, the missing company after.
 * Nothing is written. null: the database didn't say (asked again next time).
 */
export async function quickBooksReceiptsReady(admin: Admin): Promise<boolean | null> {
  if (seenReady) return true;
  const { error } = await admin
    .from("quickbooks_sync")
    .insert({ company_id: NO_COMPANY, realm_id: "-", record_type: "receipt", record_id: NO_COMPANY, status: "waiting" });
  if (!error) {
    await admin.from("quickbooks_sync").delete().eq("company_id", NO_COMPANY);
    seenReady = true;
    return true;
  }
  if (error.code === "23503") {
    seenReady = true;
    return true;
  }
  if (error.code === "23514" && /quickbooks_sync_record_type_check/.test(error.message)) return false;
  return null;
}
