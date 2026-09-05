import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signerUpdatesForContact,
  type ContactForSigners,
  type SignerOnDocument,
} from "./signers-follow-contact.ts";

/**
 * Which signature lines follow a renamed client card. The failure this
 * exists to stop is EST-1081: the contact became Jeremy Johnson, the
 * document header said so, and the customer's signature line at the
 * bottom still said James Havens. The other edge -- a line that must
 * NOT move because somebody already signed -- is tested just as hard.
 */

const jeremy: ContactForSigners = {
  first_name: "Jeremy",
  last_name: "Johnson",
  email: "heather@toyboxbrands.com",
  phone: "(310) 555-0100",
  second_contact_first_name: null,
  second_contact_last_name: null,
  second_contact_email: null,
  second_contact_phone: null,
};

function signer(over: Partial<SignerOnDocument>): SignerOnDocument {
  return {
    id: "s0",
    estimate_id: "est-1081",
    party: "customer",
    name: "James Havens",
    email: "james@example.com",
    phone: null,
    sort_order: 0,
    signed_at: null,
    estimate_status: "Draft",
    ...over,
  };
}

test("an unsigned customer line on a draft takes the card's current name", () => {
  assert.deepEqual(signerUpdatesForContact([signer({})], jeremy), [
    { id: "s0", name: "Jeremy Johnson", email: "heather@toyboxbrands.com", phone: "(310) 555-0100" },
  ]);
});

test("a sent-but-unsigned document follows the card too", () => {
  assert.equal(signerUpdatesForContact([signer({ estimate_status: "Sent" })], jeremy).length, 1);
  assert.equal(signerUpdatesForContact([signer({ estimate_status: "Viewed" })], jeremy).length, 1);
});

test("a line that already matches the card writes nothing", () => {
  const same = signer({
    name: "Jeremy Johnson",
    email: "heather@toyboxbrands.com",
    phone: "(310) 555-0100",
  });
  assert.deepEqual(signerUpdatesForContact([same], jeremy), []);
});

test("the contractor's own line is never touched", () => {
  const company = signer({ id: "c", party: "company", name: "Jonathan Wizman", sort_order: -1 });
  assert.deepEqual(signerUpdatesForContact([company], jeremy), []);
});

test("a signed line stays exactly as it was signed", () => {
  const signed = signer({ signed_at: "2026-09-05T18:00:00Z" });
  assert.deepEqual(signerUpdatesForContact([signed], jeremy), []);
});

test("a signed or cancelled document is a record: nothing on it moves", () => {
  assert.deepEqual(signerUpdatesForContact([signer({ estimate_status: "Signed" })], jeremy), []);
  assert.deepEqual(signerUpdatesForContact([signer({ estimate_status: "Void" })], jeremy), []);
});

test("once one owner has signed, the other owner's line is frozen with it", () => {
  const owner1 = signer({ id: "a", signed_at: "2026-09-05T18:00:00Z", name: "James Havens" });
  const owner2 = signer({ id: "b", sort_order: 1, name: "Pat Havens" });
  const card = { ...jeremy, second_contact_first_name: "Patricia", second_contact_last_name: "Johnson" };
  assert.deepEqual(signerUpdatesForContact([owner1, owner2], card), []);
});

test("the lock is per document: another open estimate for the same contact still follows the card", () => {
  const signedDoc = signer({ id: "a", estimate_id: "est-1", signed_at: "2026-09-05T18:00:00Z" });
  const openDoc = signer({ id: "b", estimate_id: "est-2" });
  assert.deepEqual(
    signerUpdatesForContact([signedDoc, openDoc], jeremy).map((u) => u.id),
    ["b"]
  );
});

test("the second contact's line follows the second contact on the card", () => {
  const card: ContactForSigners = {
    ...jeremy,
    second_contact_first_name: "Patricia",
    second_contact_last_name: "Johnson",
    second_contact_email: "pat@example.com",
    second_contact_phone: null,
  };
  const spouse = signer({ id: "s1", sort_order: 1, name: "Co-owner", email: null });
  assert.deepEqual(signerUpdatesForContact([spouse], card), [
    { id: "s1", name: "Patricia Johnson", email: "pat@example.com", phone: null },
  ]);
});

test("clearing the second contact from the card leaves their line alone", () => {
  const spouse = signer({ id: "s1", sort_order: 1, name: "Pat Havens", email: "pat@example.com" });
  assert.deepEqual(signerUpdatesForContact([spouse], jeremy), []);
});

test("a card with no name keeps the name already on the line", () => {
  const blank = { ...jeremy, first_name: null, last_name: null };
  assert.deepEqual(signerUpdatesForContact([signer({})], blank), [
    { id: "s0", name: "James Havens", email: "heather@toyboxbrands.com", phone: "(310) 555-0100" },
  ]);
});
