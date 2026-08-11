import "server-only";
import { normalizePhone } from "@/lib/data/types";
import { selectAll } from "@/lib/data/select-all";

type LeadPhoneRow = {
  id: string;
  phone: string | null;
  second_contact_phone: string | null;
};

/**
 * Either Supabase client, widened at the boundary.
 *
 * Typed as `unknown` and narrowed below on purpose: naming the real
 * builder type here makes the compiler expand the generated Database
 * generics through every chained method and give up ("type instantiation
 * is excessively deep"). The shape asserted below is the whole contract.
 */
type LeadQueryClient = { from: (table: string) => unknown };

type LeadRangeQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      range: (from: number, to: number) => PromiseLike<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * The lead that owns a phone number, or null.
 *
 * Used by both directions so a call is filed the same way whether the
 * customer rang in or a rep dialled out.
 *
 * Returns null when more than one lead has the number, rather than
 * picking one. That is not caution for its own sake -- in this book
 * 6469304111 is on four different names, and 8182687398 is on two
 * unrelated people. Guessing would file a call on a customer who was
 * never spoken to, which is worse than leaving it in Call Reports under
 * the number alone.
 *
 * selectAll, because a bare select stops at 1000 rows in silence: with
 * 1510 leads, every customer past that point simply failed to match and
 * their calls logged against nobody.
 */
export async function leadForPhoneNumber(
  client: LeadQueryClient,
  companyId: string,
  phone: string | null | undefined
): Promise<string | null> {
  const digits = normalizePhone(phone ?? "");
  // Ten digits or it isn't a number worth matching -- a short or empty
  // string would otherwise match every lead with a blank phone field.
  if (digits.length < 10) return null;

  const rows = await selectAll<LeadPhoneRow>((from, to) =>
    (client.from("leads") as LeadRangeQuery)
      .select("id, phone, second_contact_phone")
      .eq("company_id", companyId)
      .range(from, to)
  );

  const matches = rows.filter(
    (l) =>
      (l.phone && normalizePhone(l.phone) === digits) ||
      (l.second_contact_phone && normalizePhone(l.second_contact_phone) === digits)
  );
  return matches.length === 1 ? matches[0].id : null;
}
