import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaggedStage } from "./stage-keys";

/** A company's pipeline in board order, with each stage's tag (DECISIONS #120). */
export async function loadTaggedStages(client: SupabaseClient, companyId: string): Promise<TaggedStage[]> {
  const { data } = await client
    .from("pipeline_stages")
    .select("name, key, sort_order")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true });
  return (data ?? []) as TaggedStage[];
}
