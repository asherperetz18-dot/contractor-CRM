/**
 * Keeping the customer's signature line in step with the client card.
 *
 * An estimate copies the client's name onto its customer signer row the
 * moment it is created, and that copy never used to change. So a rep
 * who fixed a typo on the contact card -- or renamed the contact
 * outright -- got a document whose "Prepared for" header (drawn live
 * from the lead) said one name while the signature block at the bottom
 * still said the old one. EST-1081 went out to Jeremy Johnson with
 * "James Havens" under the customer's signature line.
 *
 * A plain module, deliberately: the rule of which rows may follow the
 * card is the whole risk here, and it is tested on its own without a
 * database. The action that writes the result is in
 * src/lib/signers-sync.ts.
 */

import type { EstimateStatus } from "./types";

/** The parts of the client card a signature line is copied from. */
export type ContactForSigners = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  second_contact_first_name: string | null;
  second_contact_last_name: string | null;
  second_contact_email: string | null;
  second_contact_phone: string | null;
};

/** One signer row as stored, with the status of the document it is on. */
export type SignerOnDocument = {
  id: string;
  estimate_id: string;
  party: "company" | "customer";
  name: string;
  email: string | null;
  phone: string | null;
  sort_order: number;
  signed_at: string | null;
  estimate_status: EstimateStatus;
};

export type SignerUpdate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/**
 * Which signer rows need rewriting so they match the contact, and what
 * to write on each.
 *
 * Only a line nobody has signed yet may change, and only on a document
 * nobody has signed at all. Once any customer has put a name on a
 * document it is a contract, and the names on it are part of what was
 * agreed -- the same line estimateLocked draws for prices. Signed and
 * cancelled documents are records and are left exactly as they are.
 *
 * Row 0 is the client, row 1 the second contact (spouse / co-owner) --
 * the same slots createEstimate fills. A second-contact row is only
 * touched while the card still has a second contact; clearing the
 * spouse from the card does not silently rename their line to
 * "Co-owner". A client whose name has been emptied keeps the name the
 * row already had: the column is not null, and a blank signature line
 * is worse than a stale one.
 *
 * Returns only rows where something actually differs, so a save that
 * changed nothing about the names writes nothing.
 */
export function signerUpdatesForContact(
  signers: SignerOnDocument[],
  contact: ContactForSigners
): SignerUpdate[] {
  const lockedDocuments = new Set<string>();
  for (const s of signers) {
    if (s.estimate_status === "Signed" || s.estimate_status === "Void") {
      lockedDocuments.add(s.estimate_id);
    } else if (s.party === "customer" && s.signed_at) {
      lockedDocuments.add(s.estimate_id);
    }
  }

  const clientName = fullName(contact.first_name, contact.last_name);
  const secondName = fullName(contact.second_contact_first_name, contact.second_contact_last_name);
  const hasSecondContact = !!(secondName || contact.second_contact_email);

  const updates: SignerUpdate[] = [];
  for (const s of signers) {
    if (s.party !== "customer" || s.signed_at) continue;
    if (lockedDocuments.has(s.estimate_id)) continue;

    let next: SignerUpdate | null = null;
    if (s.sort_order === 0) {
      next = {
        id: s.id,
        name: clientName || s.name,
        email: contact.email,
        phone: contact.phone,
      };
    } else if (s.sort_order === 1 && hasSecondContact) {
      next = {
        id: s.id,
        name: secondName || "Co-owner",
        email: contact.second_contact_email,
        phone: contact.second_contact_phone,
      };
    }
    if (!next) continue;

    const same =
      next.name === s.name &&
      (next.email ?? null) === (s.email ?? null) &&
      (next.phone ?? null) === (s.phone ?? null);
    if (!same) updates.push(next);
  }
  return updates;
}
