import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, originalSender, parseLeadEmail, sourceForSender } from "./inbound-email.ts";

describe("sourceForSender", () => {
  it("maps the big lead services by domain", () => {
    assert.equal(sourceForSender("noreply@proreferral.homedepot.com"), "Home Depot Pro Referral");
    assert.equal(sourceForSender("leads@angi.com"), "Angi");
    assert.equal(sourceForSender("no-reply@thumbtack.com"), "Thumbtack");
  });
  it("falls back to the sender's domain", () => {
    assert.equal(sourceForSender("office@answerfirst.io"), "Email: answerfirst.io");
  });
});

describe("originalSender", () => {
  it("digs the service out of a Gmail auto-forward", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Pro Referral <noreply@proreferral.homedepot.com>",
      "Date: Sat, Aug 29, 2026",
      "Subject: New lead in Sherman Oaks",
    ].join("\n");
    assert.match(originalSender("Asher P <asher@gmail.com>", text), /proreferral\.homedepot\.com/);
  });
  it("keeps the envelope sender when nothing is forwarded", () => {
    assert.equal(originalSender("a@b.com", "just a body"), "a@b.com");
  });
});

describe("parseLeadEmail", () => {
  it("reads a labeled Pro-Referral-style notification", () => {
    const parsed = parseLeadEmail({
      from: "Asher P <asher@gmail.com>",
      subject: "Fwd: You have a new lead!",
      text: [
        "---------- Forwarded message ---------",
        "From: Pro Referral <noreply@proreferral.homedepot.com>",
        "",
        "You have a new lead near Sherman Oaks, CA 91403!",
        "Customer: Gloria Mendez",
        "Project: Kitchen Remodel",
        "Location: Sherman Oaks, CA 91403",
        "Message: Looking to redo cabinets and counters next month.",
        "Log in to respond within 48 hours.",
      ].join("\n"),
      html: null,
    });
    assert.equal(parsed.source, "Home Depot Pro Referral");
    assert.equal(parsed.name, "Gloria Mendez");
    assert.equal(parsed.projectType, "Kitchen Remodel");
    assert.equal(parsed.address, "Sherman Oaks, CA 91403");
    assert.match(parsed.message ?? "", /redo cabinets/);
    assert.equal(parsed.phone, null);
  });

  it("sweeps up an unlabeled phone and customer email", () => {
    const parsed = parseLeadEmail({
      from: "alerts@answerservice.example",
      subject: "After-hours call",
      text: "Caller Maria G at (818) 555-0142 wants a roofing quote. Reach her at maria.g@example.com.",
      html: null,
    });
    assert.equal(parsed.phone, "(818) 555-0142");
    assert.equal(parsed.email, "maria.g@example.com");
  });

  it("survives an HTML-only email", () => {
    const parsed = parseLeadEmail({
      from: "no-reply@yelp.com",
      subject: "New request",
      text: null,
      html: "<div><p>Name: Dan Ortiz</p><p>Phone: 310-555-0177</p></div>",
    });
    assert.equal(parsed.source, "Yelp");
    assert.equal(parsed.name, "Dan Ortiz");
    assert.equal(parsed.phone, "310-555-0177");
  });

  it("never claims the service itself as the customer", () => {
    const parsed = parseLeadEmail({
      from: "Pro Referral <noreply@proreferral.homedepot.com>",
      subject: "New lead",
      text: "A homeowner near you needs drywall repair.",
      html: null,
    });
    assert.equal(parsed.name, null);
    assert.equal(parsed.email, null);
  });
});

describe("htmlToText", () => {
  it("keeps line structure through tags", () => {
    assert.equal(htmlToText("<p>a</p><p>b&amp;c</p>"), "a\nb&c");
  });
});
