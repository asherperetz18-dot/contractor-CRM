"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, type AppRole, type UserStatus } from "@/lib/data/types";
import { repDropdownOptions } from "@/lib/data/rep-options";

export type CloserOption = { id: string; name: string };

export type CloserContext = {
  closerId: string | null;
  assignedRepId: string | null;
  canEdit: boolean;
  options: CloserOption[];
};

/**
 * Everything the closer picker needs, fetched for itself.
 *
 * Self-loading rather than handed down as props, because the picker is
 * rendered from beside the dispatcher rather than from the contact form,
 * and the dispatcher only knows the lead's id. One round trip on open.
 */
export async function getLeadCloserContext(leadId: string): Promise<CloserContext | null> {
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

  const { data: people } = await supabase
    .from("company_members")
    .select("roles, status, profiles(id, name, email)")
    .eq("company_id", profile.company_id)
    .returns<
      {
        roles: AppRole[] | null;
        status: UserStatus | null;
        profiles: { id: string; name: string | null; email: string | null } | null;
      }[]
    >();

  // Salespeople only -- a closer runs the appointment and writes the
  // estimate, so the seat is a rep's. The current closer stays offered
  // whatever their role, or an already-filled seat would render blank.
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
    [lead.closer_id]
  )
    // Neither seated rep: the owner cannot close for themselves, and
    // the partner already holds the sale (one seat per person).
    .filter((p) => p.id !== lead.assigned_to && p.id !== lead.partner_rep_id)
    .map((p) => ({ id: p.id, name: p.name || p.email || "Unknown" }));

  // Matches the rule enforced in setLeadCloser. Sent to the client only
  // so the control can be disabled rather than failing on click -- the
  // server still decides.
  const canEdit =
    isAdminRole(profile) || lead.assigned_to === profile.id || !lead.closer_id;

  return {
    closerId: lead.closer_id,
    assignedRepId: lead.assigned_to,
    canEdit,
    options,
  };
}

/**
 * Names the closer on a lead: the person who runs the appointment and
 * writes the estimate, alongside the rep who owns the contact.
 *
 * Who may set it:
 *
 *   - Office and Admin, always.
 *   - The rep the lead is assigned to, because the share comes out of
 *     their half -- so it is theirs to give.
 *   - Anyone who can edit the lead, but only while the seat is empty.
 *
 * That last line is the one that matters. Setting a closer grants them
 * access to the contact, and without this rule a closer could then
 * quietly replace themselves with somebody else, or take a colleague's
 * seat on a job already being worked. Filling an empty seat is a normal
 * part of booking work; changing an existing one is a decision about
 * money and stays with the office or the rep who owns the lead.
 *
 * RLS still has the final say on every statement below -- this is the
 * narrower rule on top of it, not a replacement for it.
 */
export async function setLeadCloser(
  leadId: string,
  closerId: string | null
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

  if (closerId && closerId === lead.assigned_to) {
    return { error: "The assigned rep is already on this contact — pick someone else as closer." };
  }
  // One seat per person, both directions: a partner holds the sale, a
  // closer follows it, and the same name in both rows would pay one
  // person from two different rules.
  if (closerId && closerId === lead.partner_rep_id) {
    return {
      error:
        "They are this contact's partner rep. Pick a different closer, or clear the partnership first.",
    };
  }

  const isOffice = isAdminRole(profile);
  const isOwningRep = lead.assigned_to === profile.id;
  const seatIsEmpty = !lead.closer_id;
  if (!isOffice && !isOwningRep && !seatIsEmpty) {
    return {
      error:
        "This contact already has a closer. Only the office or the assigned rep can change it.",
    };
  }

  // .select() so a row refused by RLS surfaces as an error rather than
  // matching zero rows and reporting success.
  const { data, error } = await supabase
    .from("leads")
    .update({ closer_id: closerId })
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't update the closer on this contact." };

  // Written down, because it is a change to who gets paid. A share
  // argued over months later is argued from this timeline.
  const who = profile.name || profile.email || "staff";
  if (closerId) {
    const { data: closer } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", closerId)
      .maybeSingle<{ name: string | null; email: string | null }>();
    const closerName = closer?.name || closer?.email || "someone";
    await supabase.from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: leadId,
      author_id: profile.id,
      body: `Closer set to ${closerName} by ${who}.`,
    });
  } else {
    await supabase.from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: leadId,
      author_id: profile.id,
      body: `Closer removed by ${who}.`,
    });
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  return {};
}
