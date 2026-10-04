import { test } from "node:test";
import assert from "node:assert/strict";
import { fileRouteTarget, privateFileUrl } from "./file-url.ts";

/**
 * Photos, documents and receipts used to be saved as permanent public
 * Supabase links: anyone holding one could open the file, signed in or
 * not, for ever. They are now saved as an address inside the CRM, which
 * checks who is asking before it hands out a link that expires
 * (DECISIONS #108).
 */

test("a stored file is addressed inside the CRM, one encoded segment at a time", () => {
  assert.equal(
    privateFileUrl("lead-files", "lead-1/1700000000-roof photo.jpg"),
    "/api/files/lead-files/lead-1/1700000000-roof%20photo.jpg"
  );
  assert.equal(
    privateFileUrl("company-docs", "co-9/1-licence & bond.pdf"),
    "/api/files/company-docs/co-9/1-licence%20%26%20bond.pdf"
  );
});

test("the route reads back exactly the bucket and path that were saved", () => {
  const path = "receipts/_company/co-9/1700000000-Home Depot (fuel).pdf";
  assert.deepEqual(fileRouteTarget(privateFileUrl("lead-files", path)), { bucket: "lead-files", path });
});

test("links rewritten from the old public form still resolve", () => {
  // The migration keeps the old link's tail as Supabase encoded it
  // (encodeURI: spaces escaped, & and , left alone).
  assert.deepEqual(fileRouteTarget("/api/files/lead-files/lead-1/17-a%20b&c,d.jpg"), {
    bucket: "lead-files",
    path: "lead-1/17-a b&c,d.jpg",
  });
});

test("only the private buckets are served, and never a path that climbs out", () => {
  // Logos stay public: the portal shows one before the customer signs in.
  assert.equal(fileRouteTarget("/api/files/logos/company/logo-1.png"), null);
  assert.equal(fileRouteTarget("/api/files/secrets/x"), null);
  assert.equal(fileRouteTarget("/api/files/lead-files/"), null);
  assert.equal(fileRouteTarget("/api/files/lead-files/a/../b"), null);
  assert.equal(fileRouteTarget("/api/files/lead-files/a//b"), null);
  assert.equal(fileRouteTarget("/api/files/lead-files/%E0%A4%A"), null); // broken escape
  assert.equal(fileRouteTarget("/api/other/lead-files/a"), null);
});
