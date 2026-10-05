import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_WORDS,
  WORD_CHOICES,
  WORD_KEYS,
  readCompanyWords,
  storedWords,
  word,
  wordProblem,
} from "./company-words.ts";

/**
 * The words a company can change (DECISIONS #121): what it calls an
 * estimate, a project, an appointment, a contract, a rep, a customer, a
 * change order and a deposit. Customers read these in texts, emails, the
 * portal and on documents, so a bad value must never reach them -- a
 * missing or broken one falls back to the standard word.
 */

test("eight words, each with its standard form first among the choices", () => {
  assert.deepEqual(
    [...WORD_KEYS],
    ["estimate", "project", "appointment", "contract", "rep", "customer", "change_order", "deposit"]
  );
  for (const key of WORD_KEYS) {
    assert.deepEqual(WORD_CHOICES[key][0], STANDARD_WORDS[key], key);
    for (const choice of WORD_CHOICES[key]) assert.equal(wordProblem(choice), null, `${key}: ${choice.one}`);
  }
  assert.deepEqual(
    WORD_CHOICES.estimate.map((c) => c.one),
    ["Estimate", "Proposal", "Quote", "Bid"]
  );
});

test("a company's saved words are read whole; anything missing or broken is the standard word", () => {
  const words = readCompanyWords({
    estimate: { one: "Proposal", many: "Proposals" },
    project: { one: "Job", many: "Jobs" },
    rep: { one: "", many: "Techs" }, // broken: no singular
    contract: "Agreement", // broken: not a pair
    nonsense: { one: "X", many: "Y" }, // not one of the eight
  });
  assert.deepEqual(words.estimate, { one: "Proposal", many: "Proposals" });
  assert.deepEqual(words.project, { one: "Job", many: "Jobs" });
  assert.deepEqual(words.rep, STANDARD_WORDS.rep);
  assert.deepEqual(words.contract, STANDARD_WORDS.contract);
  assert.equal("nonsense" in words, false);
  // Before the column exists, or for a company that never changed a word.
  assert.deepEqual(readCompanyWords(null), STANDARD_WORDS);
  assert.deepEqual(readCompanyWords("garbage"), STANDARD_WORDS);
});

test("a word in a sentence: plural, lower case, and a or an", () => {
  const words = readCompanyWords({
    estimate: { one: "Estimate", many: "Estimates" },
    project: { one: "Work Order", many: "Work Orders" },
    appointment: { one: "HVAC Visit", many: "HVAC Visits" },
    deposit: { one: "Down Payment", many: "Down Payments" },
  });
  assert.equal(word(words, "estimate"), "Estimate");
  assert.equal(word(words, "estimate", { many: true }), "Estimates");
  assert.equal(word(words, "estimate", { lower: true }), "estimate");
  assert.equal(word(words, "estimate", { lower: true, a: true }), "an estimate");
  assert.equal(word(words, "project", { lower: true, a: true }), "a work order");
  // An acronym keeps its capitals in the middle of a sentence.
  assert.equal(word(words, "appointment", { lower: true, a: true }), "an HVAC visit");
  assert.equal(word(words, "deposit", { lower: true, many: true }), "down payments");
});

test("what a company may type: short, plain words that read the same in a text message", () => {
  assert.equal(wordProblem({ one: "Bid Proposal", many: "Bid Proposals" }), null);
  assert.equal(wordProblem({ one: "Owner's Rep", many: "Owner's Reps" }), null);
  assert.equal(wordProblem({ one: "Sign-off", many: "Sign-offs" }), null);
  assert.match(wordProblem({ one: "", many: "Jobs" }) ?? "", /singular/i);
  assert.match(wordProblem({ one: "Job", many: " " }) ?? "", /plural/i);
  assert.match(wordProblem({ one: "A".repeat(31), many: "Jobs" }) ?? "", /30/);
  // No links, markup or emoji in something customers are sent.
  assert.ok(wordProblem({ one: "<b>Job</b>", many: "Jobs" }));
  assert.ok(wordProblem({ one: "Job 🔨", many: "Jobs" }));
  assert.ok(wordProblem({ one: "see example.com", many: "Jobs" }));
});

test("only the words a company changed are stored, trimmed", () => {
  assert.deepEqual(
    storedWords({
      estimate: { one: " Proposal ", many: "Proposals" },
      project: { ...STANDARD_WORDS.project },
    }),
    { words: { estimate: { one: "Proposal", many: "Proposals" } } }
  );
  assert.deepEqual(storedWords({ rep: { one: "Tech", many: "" } }), {
    error: "Rep: type the plural, e.g. Reps.",
  });
});
