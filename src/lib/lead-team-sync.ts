import "server-only";

import { revalidatePath } from "next/cache";
import { leadTeamFills, type VisitSeats } from "@/lib/lead-team-fill";

/**
 * The querying client, widened at the boundary -- same reasoning as
 * events/confirmation.ts: naming the real builder type makes the
 * compiler expand the generated Database generics through every chained
 * method and give up. The chain below is the whole contract.
 */
type Chain = PromiseLike<{ data: unknown }> & {
  select: (columns: string) => Chain;
  update: (values: Record<string, unknown>) => Chain;
  insert: (values: Record<string, unknown>) => Chain;
  eq: (column: string, value: string) => Chain;
  is: (column: string, value: null) => Chain;
  in: (column: string, values: string[]) => Chain;
  maybeSingle: () => PromiseLike<{ data: unknown }>;
};

type SeatRow = {
  assigned_to: string | null;
  partner_rep_id: string | null;
  closer_id: string | null;
};

/**
 * Linked cards: saving an appointment fills the contact's empty team
 * seats from the visit seats (leadTeamFills has the rules and the
 * tests; a held seat is never overwritten).
 *
 * Best-effort by design: the appointment save has already succeeded
 * when this runs, and a viewer whose RLS cannot write the lead (a
 * dispatch-scoped user on a colleague's contact) must still get their
 * appointment saved -- the update simply matches nothing. The empty-
 * seat guard is in the UPDATE statement itself (`.is(column, null)`),
 * not a read-then-write, so two saves racing cannot both fill a seat.
 *
 * Every fill that lands leaves a note on the customer's timeline, so
 * "who set this rep?" always has an answer.
 */
export async function applyLeadTeamFills(
  client: unknown,
  profile: { id: string; company_id: string },
  leadId: string,
  visit: VisitSeats
): Promise<void> {
  if (!visit.assigned_to && !visit.second_assigned_to) return;
  const from = (table: string) =>
    (client as { from: (table: string) => unknown }).from(table) as Chain;

  try {
    const { data } = await from("leads")
      .select("assigned_to, partner_rep_id, closer_id")
      .eq("id", leadId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    const lead = data as SeatRow | null;
    if (!lead) return;

    const fills = leadTeamFills(lead, visit);
    const landed: { label: string; id: string }[] = [];

    if (fills.assigned_to) {
      const { data: rows } = await from("leads")
        .update({ assigned_to: fills.assigned_to })
        .eq("id", leadId)
        .eq("company_id", profile.company_id)
        .is("assigned_to", null)
        .select("id");
      if ((rows as unknown[] | null)?.length) {
        landed.push({ label: "Rep", id: fills.assigned_to });
      }
    }

    if (fills.partner_rep_id) {
      const { data: rows } = await from("leads")
        .update({ partner_rep_id: fills.partner_rep_id })
        .eq("id", leadId)
        .eq("company_id", profile.company_id)
        .is("partner_rep_id", null)
        .select("id");
      if ((rows as unknown[] | null)?.length) {
        landed.push({ label: "Partner", id: fills.partner_rep_id });
      }
    }

    if (landed.length === 0) return;

    const { data: profs } = await from("profiles")
      .select("id, name, email")
      .in(
        "id",
        landed.map((l) => l.id)
      );
    const nameById = new Map(
      ((profs as { id: string; name: string | null; email: string | null }[] | null) ?? []).map(
        (p) => [p.id, p.name || p.email || "Unnamed"]
      )
    );
    const parts = landed.map((l) => `${l.label} — ${nameById.get(l.id) ?? "Unnamed"}`);
    await from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: leadId,
      author_id: profile.id,
      body: `Team filled from the appointment: ${parts.join(", ")}.`,
    });

    // The contact card and its boards show the new seats without a reload.
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
  } catch {
    // Swallowed on purpose: a failed fill must never fail, or even
    // error-toast, the appointment save that triggered it.
  }
}
