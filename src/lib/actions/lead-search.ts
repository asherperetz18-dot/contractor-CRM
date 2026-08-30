"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { PipelineStage } from "@/lib/data/types";

/** Stage travels with the match because booking moves the lead on from
 * whatever stage it is in, and the wizard no longer holds the full row. */
export type LeadMatch = { id: string; label: string; phone: string | null; stage: PipelineStage };

const LIMIT = 20;

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
    .select("id, contact_type, company_name, first_name, last_name, phone, stage")
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
    stage: PipelineStage;
  }[]).map((l) => ({
    id: l.id,
    phone: l.phone,
    stage: l.stage,
    // Same label the wizard showed when it filtered in the browser.
    label:
      l.contact_type === "Company"
        ? l.company_name || "Unnamed Company"
        : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim(),
  }));
}
