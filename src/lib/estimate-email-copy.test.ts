import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultEstimateNarrative, paragraphsToHtml } from "./estimate-email-copy.ts";

test("defaultEstimateNarrative: full sentence with title and address", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: "Kitchen Remodel",
    projectAddress: "482 Alder Way, Portland, OR 97205",
    totalCents: 1436478,
  });
  assert.match(text, /on your Kitchen Remodel project/);
  assert.match(text, /Aloush Contracting has prepared proposal #EST-1214/);
  assert.match(text, /at 482 Alder Way, Portland, OR 97205/);
  assert.match(text, /\$14,364\.78/);
});

test("defaultEstimateNarrative: drops the project/address clauses whole when absent, not a blank", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: null,
    projectAddress: null,
    totalCents: 100000,
  });
  assert.match(text, /work with you\./);
  assert.doesNotMatch(text, /on your.*project/);
  assert.match(text, /for your project\. The grand total/);
  assert.doesNotMatch(text, / at \./);
});

test("defaultEstimateNarrative: three paragraphs separated by a blank line", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: null,
    projectAddress: null,
    totalCents: 100000,
  });
  const paragraphs = text.split(/\n\s*\n/);
  assert.equal(paragraphs.length, 3);
});

test("paragraphsToHtml: wraps each paragraph in its own <p>, escaping HTML", () => {
  const html = paragraphsToHtml("Hello <script>alert(1)</script>\n\nSecond paragraph");
  assert.match(html, /<p>Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
  assert.match(html, /<p>Second paragraph<\/p>/);
  assert.doesNotMatch(html, /<script>/);
});

test("paragraphsToHtml: trims stray whitespace and drops empty paragraphs", () => {
  const html = paragraphsToHtml("  First  \n\n\n\n  Second  ");
  assert.equal(html, "<p>First</p>\n<p>Second</p>");
});
