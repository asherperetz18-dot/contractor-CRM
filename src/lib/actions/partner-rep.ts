"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, type AppRole, type UserStatus } from "@/lib/data/types";
import { repDropdownOptions } from "@/lib/data/rep-options";

export type PartnerOption = { id: string; name: string };

export type PartnerContext = {
  partnerId: string | null;
  assignedRepId: string | null;
  canEdit: boolean;
  options: PartnerOption[];
  /** The most recent appointment's second chair, when they hold no seat
   *  on the lead yet -- offered as a one-click suggestion, never set on
   *  its own. Somebody confirms a partnership; the calendar only hints. */
  suggestion: PartnerOption | null;
};

/**
 * Everything the partner picker needs, fetched for itself -- the same
 * self-loading shape as the closer picker beside it, and for the same
 * reason: it is mounted from beside the dispatcher and only knows the
 * lead's id.
 */
export async function getLeadPartnerContext(leadId: string): Promise<PartnerContext | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, partner_rep_id, closer_id")
    .eq("id", leadId)
    .maybeSingle<{
      id: string;
      assigned_to: string | null;
      partner_rep_id: string | null;
      closer_id: string | null;
    }>();
  if (!lead) return null;

  const [{ data: people }, { data: lastEvent }] = await Promise.all([
    supabase
      .from("company_members")
      .select("roles, status, profiles(id, name, email)")
      .eq("company_id", profile.company_id)
      .returns<
        {
          roles: AppRole[] | null;
          status: UserStatus | null;
          profiles: { id: string; name: string | null; email: string | null } | null;
        }[]
      >(),
    supabase
      .from("events")
      .select("second_assigned_to")
      .eq("lead_id", leadId)
      .not("second_assigned_to", "is", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle<{ second_assigned_to: string | null }>(),
  ]);

  // Salespeople only, same as the closer picker beside it -- a partner
  // shares the sale, so the seat is a rep's. The current partner stays
  // offered whatever their role, or a filled seat would render blank.
  // Neither of the other seats is offered: the owner cannot partner
  // with themselves, and the closer holds a different kind of seat.
  const options = repDropdownOptions(
    (people ?? [])
      .filter(
        (row): row is (typeof row) & { profiles: NonNullable<(typeof row)["profiles"]> } =>
          !!row.profiles
      )
      .map((row) => ({
        id: row.profiles.id,
        name: row.profiles.name,
        email: row.profiles.email,
        roles: row.roles,
        status: row.status,
      })),
    [lead.partner_rep_id]
  )
    .filter((p) => p.id !== lead.assigned_to && p.id !== lead.closer_id)
    .map((p) => ({ id: p.id, name: p.name || p.email || "Unknown" }));

  // The appointment's second chair, surfaced only while the partner
  // seat is empty and they hold no other seat on this lead.
  let suggestion: PartnerOption | null = null;
  const secondChair = lastEvent?.second_assigned_to ?? null;
  if (
    !lead.partner_rep_id &&
    secondChair &&
    secondChair !== lead.assigned_to &&
    secondChair !== lead.closer_id
  ) {
    suggestion = options.find((o) => o.id === secondChair) ?? null;
  }

  // Matches the rule enforced in setLeadPartner. Sent to the client only
  // so the control can be disabled rather than failing on click -- the
  // server still decides.
  const canEdit =
    isAdminRole(profile) || lead.assigned_to === profile.id || !lead.partner_rep_id;

  return {
    partnerId: lead.partner_rep_id,
    assignedRepId: lead.assigned_to,
    canEdit,
    options,
    suggestion,
  };
}

/**
 * Names the partner rep on a lead: the second salesperson who shares
 * the sale with the owner -- both hold the lead, both get sale credit
 * at half value, and at signature they split the rep share.
 *
 * Who may set it follows the closer's rule exactly, and for the same
 * money reason: the half comes out of the owner's sale, so it is the
 * owner's (or the office's) to give. Anyone who can edit the lead may
 * fill an EMPTY seat -- booking a partnership is normal work -- but
 * changing an existing one is a decision about pay and stays with the
 * office or the owning rep. RLS still has the final say below.
 */
export async function setLeadPartner(
  leadId: string,
  partnerId: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, partner_rep_id, closer_id")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      assigned_to: string | null;
      partner_rep_id: string | null;
      closer_id: string | null;
    }>();
  if (!lead) return { error: "Contact not found, or you can't open it." };

  if (partnerId && partnerId === lead.assigned_to) {
    return { error: "That is already the assigned rep — a partnership takes two people." };
  }
  if (partnerId && partnerId === lead.closer_id) {
    return {
      error:
        "They are this contact's closer. A closer follows the job with their own cut — pick a different partner, or clear the closer first.",
    };
  }

  const isOffice = isAdminRole(profile);
  const isOwningRep = lead.assigned_to === profile.id;
  const seatIsEmpty = !lead.partner_rep_id;
  if (!isOffice && !isOwningRep && !seatIsEmpty) {
    return {
      error:
        "This contact already has a partner rep. Only the office or the assigned rep can change it.",
    };
  }

  // .select() so a row refused by RLS surfaces as an error rather than
  // matching zero rows and reporting success.
  const { data, error } = await supabase
    .from("leads")
    .update({ partner_rep_id: partnerId })
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't update the partner on this contact." };

  // Written down, because it is a change to who gets paid and whose
  // sale this counts as. A split argued over months later is argued
  // from this timeline.
  const who = profile.name || profile.email || "staff";
  if (partnerId) {
    const { data: partner } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", partnerId)
      .maybeSingle<{ name: string | null; email: string | null }>();
    const partnerName = partner?.name || partner?.email || "someone";
    await supabase.from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: leadId,
      author_id: profile.id,
      body: `Partner rep set to ${partnerName} by ${who} — the sale is now a partnership.`,
    });
  } else {
    await supabase.from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: leadId,
      author_id: profile.id,
      body: `Partner rep removed by ${who}.`,
    });
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  revalidatePath("/salespeople");
  return {};
}
