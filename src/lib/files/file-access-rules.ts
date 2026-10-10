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
 * job's files (minus WhatsApp copies from a crew group, #198), the
 * company documents marked for the portal, and a
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

  const { data: own } = await admin
    .from("lead_files")
    .select("id")
    .eq("file_path", path)
    .eq("lead_id", viewer.leadId)
    .limit(1);
  const fileId = ((own ?? []) as { id: string }[])[0]?.id;
  if (fileId) {
    if (!(await hiddenWhatsAppFiles(admin, viewer.companyId, [fileId])).has(fileId)) return true;
    // A crew group's photo stays office-only -- unless the office put
    // it on one of the customer's own sent documents, which shows it.
    const { data: placed } = await admin.from("estimate_files").select("estimate_id").eq("lead_file_id", fileId);
    const onDocs = [...new Set(((placed ?? []) as { estimate_id: string }[]).map((p) => p.estimate_id))];
    if (onDocs.length === 0) return false;
    return any(
      admin.from("estimates").select("id").in("id", onDocs).eq("lead_id", viewer.leadId).neq("status", "Draft").limit(1)
    );
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

/**
 * Of these lead files, the ones copied from a job's WhatsApp group that
 * the customer must not see (DECISIONS #198): a copy from a group the
 * office didn't mark as the client's own -- a crew group -- or from a
 * group that's no longer linked. Files that aren't WhatsApp copies are
 * never in it. Before migration 0229 no group can be marked, so the
 * failed read leaves every copy office-only.
 */
export async function hiddenWhatsAppFiles(
  admin: SupabaseClient,
  companyId: string,
  fileIds: string[]
): Promise<Set<string>> {
  const hidden = new Set<string>();
  // In slices, so a customer with hundreds of files never builds a
  // request address too long to send.
  for (let i = 0; i < fileIds.length; i += 100) {
    const { data: copies } = await admin
      .from("whatsapp_group_messages")
      .select("lead_file_id, group_id")
      .eq("company_id", companyId)
      .in("lead_file_id", fileIds.slice(i, i + 100));
    const rows = (copies ?? []) as { lead_file_id: string; group_id: string }[];
    if (!rows.length) continue;
    const { data: links } = await admin
      .from("whatsapp_group_links")
      .select("group_id, show_to_client")
      .eq("company_id", companyId)
      .in("group_id", [...new Set(rows.map((r) => r.group_id))]);
    const shown = new Set(
      ((links ?? []) as { group_id: string; show_to_client?: boolean | null }[])
        .filter((l) => l.show_to_client === true)
        .map((l) => l.group_id)
    );
    for (const r of rows) if (!shown.has(r.group_id)) hidden.add(r.lead_file_id);
  }
  return hidden;
}
