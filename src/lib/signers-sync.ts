import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  signerUpdatesForContact,
  type ContactForSigners,
  type SignerOnDocument,
} from "@/lib/data/signers-follow-contact";

/** A signer row with its document joined on, as the query below returns it. */
type SignerRow = Omit<SignerOnDocument, "estimate_status"> & {
  estimates: { status: SignerOnDocument["estimate_status"]; lead_id: string };
};

/**
 * Rewrites the customer signature lines on a contact's open documents
 * so they match the card as it now reads.
 *
 * Called after a contact is saved. Which rows may change is decided in
 * signerUpdatesForContact (unsigned lines on unsigned, uncancelled
 * documents only); this just fetches and writes.
 *
 * Runs as the service role: the person saving the card was allowed to
 * (RLS on leads already said so), and a Field user who can fix a phone
 * number on a contact should not be silently blocked from the signer
 * rows by the estimate-writer policy. Every statement is still scoped
 * to the contact's company.
 *
 * Best-effort on purpose. The card save has already succeeded by the
 * time this runs; a hiccup here must not report that save as failed.
 */
export async function syncSignersWithContact(
  admin: SupabaseClient,
  lead: ContactForSigners & { id: string; company_id: string }
): Promise<void> {
  // !inner so the lead_id filter on the joined estimate narrows the
  // signer rows themselves -- without it the filter only empties the
  // nested object and every signer in the company comes back.
  const { data: rows } = await admin
    .from("estimate_signers")
    .select(
      "id, estimate_id, party, name, email, phone, sort_order, signed_at, estimates!inner(status, lead_id)"
    )
    .eq("company_id", lead.company_id)
    .eq("estimates.lead_id", lead.id)
    .returns<SignerRow[]>();
  if (!rows?.length) return;

  const signers: SignerOnDocument[] = rows.map((r: SignerRow) => {
    const { estimates, ...s } = r;
    return { ...s, estimate_status: estimates.status };
  });

  const updates = signerUpdatesForContact(signers, lead);
  for (const u of updates) {
    await admin
      .from("estimate_signers")
      .update({ name: u.name, email: u.email, phone: u.phone })
      .eq("id", u.id)
      .eq("company_id", lead.company_id);
  }
}
