"use server";

import { createClient } from "@/lib/supabase/server";
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
  const [{ data: leads }, { data: stages }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name, phone, email, address, stage")
      .order("created_at", { ascending: false }),
    supabase.from("pipeline_stages").select("name, color"),
  ]);

  const rows = (leads as Lead[]) ?? [];
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
