import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Server actions that work through the admin client (which RLS never
 * sees) and take an id from the browser must first check that id is in
 * the caller's own company. These pin the checks added in DECISIONS #101
 * in place, before the work they guard.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The source of one exported function, up to the next export. */
function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("Send Portal Link finds the contact as the caller, in their company, first", () => {
  const fn = body(read("./actions/portal.ts"), "sendPortalLink");
  const check = fn.indexOf('.eq("company_id", sender.company_id)');
  assert.ok(check > 0, "sendPortalLink must check the contact's company");
  assert.ok(check < fn.indexOf("createAdminClient()"), "the check must come before any admin-client work");
});

test("every lead-file upload checks the contact's company before touching storage or Drive", () => {
  const src = read("./actions/lead-files.ts");
  for (const name of ["uploadLeadFile", "createLeadFileUploadUrl", "recordLeadFile"]) {
    const fn = body(src, name);
    const check = fn.indexOf("leadInCompany(leadId, profile.company_id)");
    assert.ok(check > 0, `${name} must call leadInCompany`);
    for (const work of ["getValidAccessToken(", ".storage", "createClient()"]) {
      const at = fn.indexOf(work);
      if (at >= 0) assert.ok(check < at, `${name}: the check must come before ${work}`);
    }
  }
});

test("the Drive plumbing is server-only, not callable as a server action", () => {
  const actions = read("./actions/google-drive.ts");
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["getGoogleDriveStatus", "disconnectGoogleDrive"]);
  assert.match(read("./google-drive-api.ts"), /^import "server-only";/);
});

test("a lead's Drive folder is looked up and saved within the company", () => {
  const fn = body(read("./google-drive-api.ts"), "getOrCreateLeadDriveFolder");
  assert.equal(fn.match(/\.eq\("company_id", companyId\)/g)?.length, 2);
});
