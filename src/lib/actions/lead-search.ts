"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { PipelineStage } from "@/lib/data/types";

/** Stage travels with the match because booking moves the lead on from
 * whatever stage it is in, and the wizard no longer holds the full row. */
export type LeadMatch = {
  id: string;
  label: string;
  phone: string | null;
  address: string | null;
  stage: PipelineStage;
  /** The contact's Assigned Rep -- pre-fills the booking's Assigned To. */
  assigned_to: string | null;
};

const LIMIT = 20;

/** What the New Estimate dialog shows per hit, and all it needs: the
 *  create call takes only the id. */
export type EstimateLeadMatch = {
  id: string;
  label: string;
  email: string | null;
  address: string | null;
};

/**
 * Contacts matching what someone typed into the New Estimate dialog.
 *
 * The dialog used to filter an array of every lead in the company,
 * shipped to it by the estimates page -- the same all-contacts payload
 * that froze Contacts and the pipeline board at 79k rows (#019/#020),
 * still riding along to draw a list of a few dozen documents. Searching
 * here keeps the dialog able to reach every lead while the page sends
 * only the leads its rows actually name.
 *
 * Matches the fields the dialog always searched -- name, email, address
 * -- plus company name, which the old filter missed: a company lead has
 * no first/last name, so it could never be found to estimate for.
 */
export async function searchEstimateLeads(query: string): Promise<EstimateLeadMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const companyId = await getCurrentCompanyId();
  if (!companyId) return [];

  const term = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, contact_type, company_name, first_name, last_name, email, address")
    .eq("company_id", companyId)
    .or(
      `first_name.ilike.${term},last_name.ilike.${term},company_name.ilike.${term},email.ilike.${term},address.ilike.${term}`
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return ((data ?? []) as {
    id: string;
    contact_type: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    address: string | null;
  }[]).map((l) => ({
    id: l.id,
    email: l.email,
    address: l.address,
    label:
      l.contact_type === "Company"
        ? l.company_name || "Unnamed Company"
        : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed lead",
  }));
}

/**
 * Contacts matching what someone has typed into the booking wizard.
 *
 * The wizard used to filter an array of every contact in the company,
 * handed to it by whichever page rendered it. That array was the single
 * reason the calendar shipped its whole contact book to the browser --
 * 3,573 rows to draw 80 appointments -- and it only got worse as the
 * book grew.
 *
 * Searching here instead means the page sends the contacts it displays
 * and nothing more, and the wizard can still reach every contact there
 * is. Runs as the signed-in user, so row-level security scopes the
 * results exactly as the contact list would.
 */
export async function searchBookableLeads(query: string): Promise<LeadMatch[]> {
  const q = query.trim();
  // Two characters is where a search starts being a search rather than a
  // request for most of the table.
  if (q.length < 2) return [];

  const companyId = await getCurrentCompanyId();
  if (!companyId) return [];

  // Escape the wildcards so a name containing % or _ searches for itself.
  const term = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, contact_type, company_name, first_name, last_name, phone, address, stage, assigned_to")
    .eq("company_id", companyId)
    .or(
      `first_name.ilike.${term},last_name.ilike.${term},company_name.ilike.${term}`
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return ((data ?? []) as {
    id: string;
    contact_type: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    address: string | null;
    stage: PipelineStage;
    assigned_to: string | null;
  }[]).map((l) => ({
    id: l.id,
    phone: l.phone,
    address: l.address,
    stage: l.stage,
    assigned_to: l.assigned_to,
    // Same label the wizard showed when it filtered in the browser.
    label:
      l.contact_type === "Company"
        ? l.company_name || "Unnamed Company"
        : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim(),
  }));
}
