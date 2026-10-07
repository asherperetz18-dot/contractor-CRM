import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateLender, financingChip, lenderChoiceError, leadFinancing } from "./financing.ts";
import { paymentChangeEmail, paymentChangeSms } from "./payment-change.ts";

/**
 * Financing through the customer's own lender (DECISIONS #168): each
 * estimate says who is financing it -- the company's lender, the
 * customer's own bank (named), or nobody -- and every step, payment
 * change and payout carries that name. Only the company's lender has a
 * link to apply.
 */

// The company's lenders as a list since 0220 (DECISIONS #170); here, one.
const company = [
  { id: "sf", name: "Service Finance", url: "https://apply.example.com/dealer?id=1", feeBp: null, active: true, sortOrder: 0 },
];

test("who is financing: the company's lender by default, the customer's own when named, or nobody", () => {
  assert.deepEqual(estimateLender({ source: null, lender: null }, company), {
    name: "Service Finance",
    own: false,
    applyUrl: company[0].url,
    id: "sf",
    feeBp: null,
  });
  assert.deepEqual(estimateLender({ source: "company", lender: "ignored" }, company)?.name, "Service Finance");
  // No working company link: nothing to finance through by default.
  assert.equal(estimateLender({ source: null, lender: null }, []), null);
  assert.deepEqual(estimateLender({ source: "customer", lender: "  Harbor Credit Union " }, []), {
    name: "Harbor Credit Union",
    own: true,
    applyUrl: null,
    id: null,
    feeBp: null,
  });
  assert.equal(estimateLender({ source: "customer", lender: "" }, company), null);
  assert.equal(estimateLender({ source: "none", lender: null }, company), null);
});

test("the choice is checked: a known kind, and a name for the customer's own lender", () => {
  assert.equal(lenderChoiceError({ source: "company", lender: null }), null);
  assert.equal(lenderChoiceError({ source: "none", lender: null }), null);
  assert.equal(lenderChoiceError({ source: "customer", lender: "Harbor Credit Union" }), null);
  assert.equal(lenderChoiceError({ source: "customer", lender: "   " }), "Type the name of the customer's lender.");
  assert.equal(lenderChoiceError({ source: "customer", lender: "x".repeat(121) }), "That lender name is too long.");
  assert.equal(lenderChoiceError({ source: "bank", lender: null }), "Pick who is financing this job.");
});

test("the pipeline card names the lender on hover", () => {
  const byLead = leadFinancing(
    [{ id: "e1", lead_id: "L1", status: "Signed", kind: "contract", doc_number: "EST-1047" }],
    [{ estimate_id: "e1", status: "approved", created_at: "2026-10-07T10:00:00Z", lender: "Harbor Credit Union" }]
  );
  assert.equal(byLead.L1.lender, "Harbor Credit Union");
  assert.equal(financingChip(byLead.L1, 0).title, "EST-1047: Approved today · Harbor Credit Union");
  // A step from before 0218 has no lender: as before.
  const old = leadFinancing(
    [{ id: "e1", lead_id: "L1", status: "Signed", kind: "contract", doc_number: "EST-1047" }],
    [{ estimate_id: "e1", status: "sent", created_at: "2026-10-07T10:00:00Z" }]
  );
  assert.equal(financingChip(old.L1, 2).title, "EST-1047: Link sent 2 days ago");
});

test("a payment change through the customer's own loan says so, with no link to apply", () => {
  const base = {
    companyName: "Summit Builders Co",
    docNumber: "EST-1047",
    lender: "Harbor Credit Union",
    financeCents: 3_780_000,
    link: "https://crm.example.com/portal/verify?token=abc",
    ownLender: true,
  };
  const sms = paymentChangeSms(base);
  assert.equal(
    sms,
    "Summit Builders Co: please review and sign a payment change for EST-1047 - the rest, $37,800.00, to be paid through your loan from Harbor Credit Union instead of to us directly:\n" +
      base.link
  );
  const mail = paymentChangeEmail({ ...base, customerName: "Maria Lopez" });
  assert.match(mail.text, /through your loan from Harbor Credit Union instead of paying Summit Builders Co directly/);
  assert.match(mail.text, /If your loan doesn't come through, the original payment schedule applies\./);
  assert.doesNotMatch(mail.text, /decides on your application|Apply with/);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("stored per estimate, on every step and payment change; safe before it runs", () => {
  const sql = source("../../supabase/migrations/0218_customer_own_lender.sql");
  assert.match(sql, /add column if not exists financing_source text\s+check \(financing_source is null or financing_source in \('company', 'customer', 'none'\)\)/);
  assert.match(sql, /add column if not exists financing_lender text/);
  assert.match(sql, /alter table public\.estimate_financing_events\s+add column if not exists lender text/);
  assert.match(sql, /add column if not exists own_lender boolean not null default false/);
  assert.match(sql, /as own_lender_ready;/);
  assert.match(source("./schema-drift.ts"), /table: "estimates", column: "financing_source", migration: "0218_customer_own_lender\.sql"/);
});

test("the actions use the estimate's lender; the customer's own has no link to send", () => {
  const actions = source("./actions/financing.ts");
  const set = actions.slice(actions.indexOf("export async function setFinancingLender("));
  assert.match(set, /lenderChoiceError\(/);
  // Not while a payment change is waiting or in force with another lender.
  assert.match(set, /await openChangeError\(admin, doc\)/);
  const open = actions.slice(actions.indexOf("async function openChangeError("));
  assert.match(open, /\.from\("contract_payment_changes"\)/);
  assert.match(open, /\.in\("status", \["sent", "signed"\]\)/);
  const record = actions.slice(actions.indexOf("export async function recordFinancingStatus("));
  assert.match(record, /lenderOf\(admin, doc\)/);
  assert.match(record, /Funded loan from \$\{lender\}/);
  const send = actions.slice(actions.indexOf("export async function sendFinancingLink("));
  assert.match(send, /if \(!chosen\?\.applyUrl\)/);

  const change = source("./actions/payment-change.ts");
  assert.match(change, /estimateLender\(/);
  assert.match(change, /own_lender: true/);

  // The customer's page: no Apply card for a customer with their own lender.
  const portal = source("../app/portal/estimates/[id]/page.tsx");
  assert.match(portal, /financing_source !== "customer"/);
  assert.match(source("../app/portal/estimates/[id]/payment-change-card.tsx"), /your loan from/);

  // The office panel: the choice, always there on a document financing goes with.
  const panel = source("../app/(app)/estimates/[id]/financing-panel.tsx");
  assert.match(panel, /Who is financing this job\?/);
  assert.match(panel, /The customer&apos;s own lender/);
  assert.match(panel, /Paid out in draws\?/);
});
