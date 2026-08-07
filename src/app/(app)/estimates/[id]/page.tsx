import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Estimate, EstimateItem, EstimateSigner } from "@/lib/data/types";
import { EstimateBuilder, type BuilderLead } from "./estimate-builder";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle<Estimate>();
  if (!estimate) notFound();

  const [{ data: items }, { data: signers }, { data: lead }] = await Promise.all([
    supabase
      .from("estimate_items")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("estimate_signers")
      .select("*")
      .eq("estimate_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("leads")
      .select("id, first_name, last_name, email, phone, address")
      .eq("id", estimate.lead_id)
      .maybeSingle<BuilderLead>(),
  ]);

  return (
    <EstimateBuilder
      estimate={estimate}
      items={(items ?? []) as EstimateItem[]}
      signers={(signers ?? []) as EstimateSigner[]}
      lead={lead ?? null}
    />
  );
}
