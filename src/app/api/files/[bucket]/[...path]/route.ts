import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { portalAccessActive, readPortalSession } from "@/lib/portal/session";
import { fileRouteTarget } from "@/lib/files/file-url";
import { portalCanReadFile, staffCanReadFile } from "@/lib/files/file-access-rules";

/**
 * Opens a private file (DECISIONS #108).
 *
 * Every saved photo, document and receipt link points here. The person
 * asking is checked first -- a signed-in staff member through the
 * record's own row-level security, a portal customer against what their
 * portal shows -- and only then is a signed link minted and the browser
 * redirected to it. The signed link lasts an hour, long enough to play
 * a long site video through; the address saved in the CRM never opens
 * anything for someone who isn't allowed to see it.
 */

// Long enough for a video to finish playing: the player keeps fetching
// ranges from the signed link as it plays.
const SIGNED_SECONDS = 60 * 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
// The browser alone may reuse the redirect -- and so its cached copy of
// the file -- for five minutes, so a page of photos isn't downloaded
// again on every visit. Never a shared cache: the answer is per person.
const BRIEFLY_PRIVATE = { "Cache-Control": "private, max-age=300" };

function notFound() {
  return NextResponse.json({ error: "No such file." }, { status: 404, headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const target = fileRouteTarget(new URL(req.url).pathname);
  if (!target) return notFound();

  let allowed = false;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) allowed = await staffCanReadFile(supabase, target.bucket, target.path);

  // A customer has no Supabase session; the portal cookie says who they
  // are. Read without touching the session -- a page of photos would
  // otherwise write a "last seen" stamp per thumbnail.
  if (!allowed) {
    const session = await readPortalSession();
    if (session) {
      const admin = createAdminClient();
      const { data: lead } = await admin
        .from("leads")
        .select("portal_access_expires_at")
        .eq("id", session.lead_id)
        .maybeSingle<{ portal_access_expires_at: string | null }>();
      if (lead && portalAccessActive(lead.portal_access_expires_at)) {
        allowed = await portalCanReadFile(
          admin,
          { leadId: session.lead_id, companyId: session.company_id },
          target.bucket,
          target.path
        );
      }
    }
  }

  // The same answer for "not yours" and "not there": a guessed path
  // learns nothing.
  if (!allowed) return notFound();

  const { data, error } = await createAdminClient()
    .storage.from(target.bucket)
    .createSignedUrl(target.path, SIGNED_SECONDS);
  if (error || !data?.signedUrl) return notFound();

  return NextResponse.redirect(data.signedUrl, { status: 302, headers: BRIEFLY_PRIVATE });
}
