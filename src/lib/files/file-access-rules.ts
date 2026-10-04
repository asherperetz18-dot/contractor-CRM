import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivateFileBucket } from "./file-url.ts";

/**
 * Who may open a private file (DECISIONS #108). An object is opened
 * through the record that points at it -- a lead file, a bill or job
 * cost's receipt, a company document -- never by its path alone: a
 * merged duplicate keeps its old lead id in the path, and a bill and
 * its job cost share one receipt object.
 *
 * Pure apart from the clients handed in, so it is tested without a
 * database (file-access.test.ts).
 */

type Rows = { data: unknown[] | null };

async function any(query: PromiseLike<Rows>): Promise<boolean> {
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}

/**
 * Staff, asked with their own signed-in client: row-level security on
 * the record decides, exactly as it decides what the screens list. A
 * member of another company, or a sales-only rep on a lead that isn't
 * theirs, finds no row and so opens no file.
 */
export async function staffCanReadFile(
  supabase: SupabaseClient,
  bucket: PrivateFileBucket,
  path: string
): Promise<boolean> {
  if (bucket === "company-docs") {
    return any(supabase.from("company_documents").select("id").eq("file_path", path).limit(1));
  }
  const found = await Promise.all([
    any(supabase.from("lead_files").select("id").eq("file_path", path).limit(1)),
    any(supabase.from("job_expenses").select("id").eq("receipt_path", path).limit(1)),
    any(supabase.from("vendor_bills").select("id").eq("receipt_path", path).limit(1)),
  ]);
  return found.some(Boolean);
}

export type PortalFileViewer = { leadId: string; companyId: string };

/**
 * A portal customer, asked with the service role (a customer has no
 * Supabase session): only what the portal itself shows them. Their own
 * job's files, the company documents marked for the portal, and a
 * receipt only while a line on one of their own non-draft documents
 * bills that cost back with its receipt switched on -- a cost the
 * office never billed is internal.
 */
export async function portalCanReadFile(
  admin: SupabaseClient,
  viewer: PortalFileViewer,
  bucket: PrivateFileBucket,
  path: string
): Promise<boolean> {
  if (bucket === "company-docs") {
    return any(
      admin
        .from("company_documents")
        .select("id")
        .eq("file_path", path)
        .eq("company_id", viewer.companyId)
        .eq("show_on_portal", true)
        .limit(1)
    );
  }

  if (await any(admin.from("lead_files").select("id").eq("file_path", path).eq("lead_id", viewer.leadId).limit(1))) {
    return true;
  }

  const { data: costs } = await admin
    .from("job_expenses")
    .select("id")
    .eq("receipt_path", path)
    .eq("company_id", viewer.companyId)
    .eq("lead_id", viewer.leadId);
  const costIds = ((costs ?? []) as { id: string }[]).map((c) => c.id);
  if (costIds.length === 0) return false;

  const { data: lines } = await admin
    .from("estimate_items")
    .select("estimate_id")
    .in("source_expense_id", costIds)
    .eq("show_source_receipt", true);
  const docIds = [...new Set(((lines ?? []) as { estimate_id: string }[]).map((l) => l.estimate_id))];
  if (docIds.length === 0) return false;

  return any(
    admin
      .from("estimates")
      .select("id")
      .in("id", docIds)
      .eq("lead_id", viewer.leadId)
      .neq("status", "Draft")
      .limit(1)
  );
}
