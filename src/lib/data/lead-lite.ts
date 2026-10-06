import "server-only";
import { counterpartyPhoneKeys, firstLeadPerPhoneKey } from "@/lib/report-leads";
import type { LeadLite } from "./types";
import { selectAll } from "./select-all";

/**
 * Fetches just the leads a report page's rows reference, as LeadLite --
 * these pages used to ship the whole book to print names next to their
 * rows. Callers hand in the RLS-scoped client the page already has.
 */

const LITE_COLUMNS = "id, contact_type, company_name, first_name, last_name, phone, second_contact_phone, address";

const IN_CHUNK = 150;

type LiteClient = {
  rpc(
    fn: "leads_by_phone_keys",
    args: { p_company: string; p_keys: string[] }
  ): {
    select(columns: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
  from(table: "leads"): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: string[]): PromiseLike<{ data: unknown[] | null }>;
        order(column: string, opts: { ascending: boolean }): {
          range(from: number, to: number): PromiseLike<{
            data: unknown[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

export async function leadsLiteByIds(
  supabase: unknown,
  companyId: string,
  ids: Iterable<string | null | undefined>
): Promise<LeadLite[]> {
  const client = supabase as LiteClient;
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  const rows: LeadLite[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data } = await client
      .from("leads")
      .select(LITE_COLUMNS)
      .eq("company_id", companyId)
      .in("id", unique.slice(i, i + IN_CHUNK));
    rows.push(...((data ?? []) as LeadLite[]));
  }
  return rows;
}

/**
 * The leads an SMS list needs: everyone its messages reference by id,
 * plus phone-matches for messages that were never linked to a lead --
 * the same caller-ID-style matching the views do, resolved here so only
 * the matched contacts travel.
 *
 * The phone match is one indexed lookup (0204, DECISIONS #141). It used
 * to walk the company's whole contact book, 1000 rows at a time, and
 * still does until 0204 is run.
 */
export async function leadsLiteForMessages(
  supabase: unknown,
  companyId: string,
  messages: { lead_id: string | null; direction: string; from_number: string; to_number: string }[]
): Promise<LeadLite[]> {
  const client = supabase as LiteClient;
  const byId = await leadsLiteByIds(supabase, companyId, messages.map((m) => m.lead_id));

  const wanted = counterpartyPhoneKeys(messages);
  if (wanted.size === 0) return byId;

  const scanBook = () =>
    selectAll<LeadLite>((f, t) =>
      client
        .from("leads")
        .select(LITE_COLUMNS)
        .eq("company_id", companyId)
        // Ordered so the pager's pages can't overlap or skip -- and so the
        // first match per number is the newest contact.
        .order("created_at", { ascending: false })
        .range(f, t)
    );
  const { data, error } = await client
    .rpc("leads_by_phone_keys", { p_company: companyId, p_keys: [...wanted] })
    .select(LITE_COLUMNS);
  const newestFirst = error ? await scanBook() : ((data ?? []) as LeadLite[]);
  return [...byId, ...firstLeadPerPhoneKey(newestFirst, wanted, new Set(byId.map((l) => l.id)))];
}
