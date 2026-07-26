"use server";

import { createClient } from "@/lib/supabase/server";
import { leadDisplayName, type Lead } from "@/lib/data/types";

export type DirectoryHit = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  stage: string;
};

export async function searchDirectory(query: string): Promise<DirectoryHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, contact_type, company_name, first_name, last_name, phone, email, address, stage")
    .order("created_at", { ascending: false });

  const rows = (leads as Lead[]) ?? [];

  return rows
    .filter((l) =>
      `${leadDisplayName(l)} ${l.phone ?? ""} ${l.address ?? ""} ${l.email ?? ""}`
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      name: leadDisplayName(l),
      phone: l.phone,
      address: l.address,
      email: l.email,
      stage: l.stage,
    }));
}
