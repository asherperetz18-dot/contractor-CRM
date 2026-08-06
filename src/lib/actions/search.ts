"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  leadDisplayName,
  normalizePhone,
  stageColor,
  type Lead,
  type PipelineStageRow,
} from "@/lib/data/types";

export type DirectoryHit = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  stage: string;
  color: string;
};

export async function searchDirectory(query: string): Promise<DirectoryHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  // Paged. A plain select stops at PostgREST's 1000-row ceiling with no
  // error, so search was reading the 1000 newest contacts and quietly
  // ignoring the other 506 -- a third of the database that could not be
  // found by name, phone or address no matter what you typed.
  const [rows, { data: stages }] = await Promise.all([
    selectAll<Lead>((from, to) =>
      supabase
        .from("leads")
        .select(
          "id, contact_type, company_name, first_name, last_name, phone, email, address, stage"
        )
        .eq("company_id", companyId ?? "")
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    supabase.from("pipeline_stages").select("name, color").eq("company_id", companyId ?? ""),
  ]);

  const stageRows = (stages as Pick<PipelineStageRow, "name" | "color">[]) ?? [];

  // Phone numbers are stored with whatever formatting was typed in, so a
  // plain substring match on the raw text misses e.g. searching digits
  // only ("6263254475") against a stored "(626) 325-4475". Compare
  // normalized digits too, alongside the existing free-text match.
  const qDigits = q.replace(/\D/g, "");

  return rows
    .filter((l) => {
      const textMatch = `${leadDisplayName(l)} ${l.phone ?? ""} ${l.address ?? ""} ${l.email ?? ""}`
        .toLowerCase()
        .includes(q);
      const phoneMatch = qDigits.length >= 3 && !!l.phone && normalizePhone(l.phone).includes(qDigits);
      return textMatch || phoneMatch;
    })
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      name: leadDisplayName(l),
      phone: l.phone,
      address: l.address,
      email: l.email,
      stage: l.stage,
      color: stageColor(stageRows, l.stage),
    }));
}
