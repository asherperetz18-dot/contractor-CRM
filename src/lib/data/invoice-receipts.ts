import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { customerReceiptCostIds, receiptAttachment } from "@/lib/data/invoices";
import type { EstimateItem, EstimatePhoto } from "@/lib/data/types";

/**
 * The receipts an invoice shows its customer, one under each line that
 * bills a cost back with its receipt switched on. The portal passes its
 * service-role client (it has already checked the invoice is this
 * customer's); the staff preview passes the signed-in user's.
 */
export async function invoiceReceiptAttachments(
  client: SupabaseClient,
  companyId: string,
  items: EstimateItem[]
): Promise<EstimatePhoto[]> {
  const lines = items as (EstimateItem & {
    source_expense_id?: string | null;
    show_source_receipt?: boolean | null;
  })[];
  const costIds = customerReceiptCostIds(lines);
  if (costIds.length === 0) return [];
  const { data } = await client
    .from("job_expenses")
    .select("id, receipt_url, receipt_path")
    .eq("company_id", companyId)
    .in("id", costIds)
    .returns<{ id: string; receipt_url: string | null; receipt_path: string | null }[]>();
  const costById = new Map((data ?? []).map((c) => [c.id, c]));
  return lines.flatMap((item) => {
    const cost =
      item.source_expense_id && item.show_source_receipt !== false
        ? costById.get(item.source_expense_id)
        : undefined;
    const attachment = cost ? receiptAttachment(item.id, cost) : null;
    return attachment ? [{ ...attachment, estimate_id: item.estimate_id }] : [];
  });
}
