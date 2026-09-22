import { leadDisplayName, type LeadLite } from "./data/types.ts";

/** What the Reply Inbox pins about a compose target the moment it opens. */
export type ReplyTargetSnapshot = {
  leadId: string | null;
  name: string;
  phone: string;
};

/**
 * The name and number a "text this contact" deep-link is aimed at,
 * resolved ONCE, while the target contact is still in hand.
 *
 * The inbox strips its query string right after consuming it, and the
 * page's next render only carries contacts that already have messages
 * -- so a first-ever text to a contact lost its lead between renders
 * and the composer read "New conversation" with "No phone number to
 * send to", while the contact card sat there showing a number. Pinning
 * the snapshot up front is the fix: whatever later renders drop, the
 * thread keeps who it is for and where it goes.
 *
 * The number falls back through every one the lite row carries --
 * a contact whose only phone is the second contact's must still be
 * textable, exactly as Text Reports already matches replies on it.
 */
export function replyTargetSnapshot(
  leads: readonly LeadLite[],
  leadId: string | null,
  phoneParam: string | null
): ReplyTargetSnapshot {
  const lead = leadId ? leads.find((l) => l.id === leadId) ?? null : null;
  if (lead) {
    return {
      leadId: lead.id,
      name: leadDisplayName(lead),
      phone: lead.phone || lead.second_contact_phone || phoneParam || "",
    };
  }
  return {
    leadId,
    name: phoneParam || "New conversation",
    phone: phoneParam || "",
  };
}
