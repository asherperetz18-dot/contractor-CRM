import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The receipt file behind a bill or a job cost -- where it may be
 * uploaded, and how the server checks that a client-supplied path is
 * one it actually issued. Shared by the bill actions and the job-cost
 * actions so the two halves of "money out" keep one rule.
 *
 * Paths:
 *   receipts/<leadId>/<stamp>-<name>            a file on a job
 *   receipts/_company/<companyId>/<stamp>-<name> a file on an overhead
 *                                                bill (fuel, the office)
 * The lead id or the company id in the path is what ties the object to
 * a tenant, so the check below is the whole of the isolation between
 * companies sharing the bucket.
 */
export const RECEIPT_BUCKET = "lead-files";
export const MAX_RECEIPT_BYTES = 30 * 1024 * 1024;

export type UploadedReceipt = { path: string; fileName: string; contentType: string | null };

export function receiptUploadPath(companyId: string, leadId: string | null, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, "_").slice(-120);
  const folder = leadId ? `receipts/${leadId}` : `receipts/_company/${companyId}`;
  return `${folder}/${Date.now()}-${safeName}`;
}

/** Does this path name a slot issued for THIS job (or this company's overhead)? */
export function receiptPathBelongs(path: string, companyId: string, leadId: string | null): boolean {
  if (leadId) return path.startsWith(`receipts/${leadId}/`);
  return path.startsWith(`receipts/_company/${companyId}/`);
}

/**
 * Confirms the browser's direct-to-bucket upload actually landed, and
 * returns the columns to store. A row must never point at an object
 * that does not exist -- a failed upload would otherwise become a
 * "receipt" link that 404s forever.
 */
export async function confirmReceiptUpload(
  admin: AdminClient,
  path: string
): Promise<{ error?: string; fields?: { receipt_url: string; receipt_path: string } }> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const base = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await admin.storage.from(RECEIPT_BUCKET).list(folder, { search: base });
  if (!listed?.some((f) => f.name === base)) {
    return { error: "The receipt upload didn't finish. Try attaching it again." };
  }
  return {
    fields: {
      receipt_url: admin.storage.from(RECEIPT_BUCKET).getPublicUrl(path).data.publicUrl,
      receipt_path: path,
    },
  };
}
