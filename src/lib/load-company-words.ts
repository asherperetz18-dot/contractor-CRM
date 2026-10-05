import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STANDARD_WORDS, readCompanyWords, type CompanyWords } from "./company-words";

/**
 * A company's words (DECISIONS #121), read on their own so a message
 * never fails over them: before migration 0196 has run, or on any read
 * error, it is the standard words.
 */
export async function loadCompanyWords(client: SupabaseClient, companyId: string): Promise<CompanyWords> {
  const { data, error } = await client
    .from("company_profile")
    .select("wording")
    .eq("company_id", companyId)
    .maybeSingle<{ wording: unknown }>();
  if (error) return STANDARD_WORDS;
  return readCompanyWords(data?.wording);
}
