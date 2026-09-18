import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyNewLead } from "@/lib/notify-new-lead";
import { webhookLeadFields, type WebhookLeadFields } from "@/lib/webhook-lead";
import { withRouteObservability } from "@/lib/observability/observe";

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await req.json().catch(() => ({}));
    return Object.fromEntries(
      Object.entries(json).map(([k, v]) => [k, String(v ?? "")])
    );
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) out[k] = String(v);
  return out;
}

// No session here (public webhook), so the key has to do two jobs: prove
// the caller is allowed in, and say which company's pipeline the lead
// belongs to. Looking the company up BY the secret does both.
//
// This used to read "the one company_profile row" with .single() and
// compare secrets in JS. The moment a second company existed, .single()
// started erroring on multiple rows, so every key -- including valid
// ones -- came back "Invalid key".
async function companyForKey(
  admin: ReturnType<typeof createAdminClient>,
  key: string | null
): Promise<string | null> {
  if (!key) return null;
  const { data: company } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("webhook_secret", key)
    .maybeSingle();
  return (company as { company_id: string } | null)?.company_id ?? null;
}

async function insertLead(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  lead: WebhookLeadFields
): Promise<{ id: string; alerted: number } | { error: string }> {
  const { data, error } = await admin
    .from("leads")
    .insert({
      contact_type: "Individual",
      ...lead,
      stage: "Unsorted",
      // Required since leads.company_id became NOT NULL. Without it every
      // authenticated call still failed, just at the insert instead.
      company_id: companyId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // After the insert, and never allowed to fail it: the lead is safely
  // saved by this point, and a Twilio problem must not return an error
  // that makes Zapier or Meta retry a lead that landed fine.
  const alert = await notifyNewLead(admin, {
    companyId,
    firstName: lead.first_name || "",
    lastName: lead.last_name || "",
    phone: lead.phone || "",
    email: lead.email || "",
    address: lead.address,
    projectType: lead.project_type,
    source: lead.source,
    notes: lead.notes,
  }).catch(() => ({ sent: 0, skipped: "alert failed" }));

  return { id: (data as { id: string }).id, alerted: alert.sent };
}

async function handlePost(req: NextRequest) {
  const admin = createAdminClient();
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing ?key=" }, { status: 401 });
  }
  const companyId = await companyForKey(admin, key);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(req);
  } catch {
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 });
  }

  const lead = webhookLeadFields(body);
  if (!lead) {
    return NextResponse.json(
      { error: "Provide at least a name, phone, or email." },
      { status: 400 }
    );
  }

  const result = await insertLead(admin, companyId, lead);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: result.id, alerted: result.alerted });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The GET door exists for dialer "web form" buttons -- ViciDial can only
// open a URL in the agent's browser, appending the lead's fields to the
// query string. The reader is that agent, mid-call, so the answer is a
// plain sentence in HTML, not JSON.
function htmlPage(status: number, heading: string, detail: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;background:#F7F5EF;color:#1F2937;text-align:center;padding:48px 16px">` +
      `<h1 style="font-size:22px">${escapeHtml(heading)}</h1>` +
      `<p style="color:#4B5563">${escapeHtml(detail)}</p>` +
      `</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

async function handleGet(req: NextRequest) {
  const admin = createAdminClient();
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  delete params.key;

  const companyId = await companyForKey(admin, req.nextUrl.searchParams.get("key"));
  if (!companyId) {
    return htmlPage(401, "Link not recognized", "This lead link is missing its key or the key was regenerated. Copy a fresh URL from Settings › Incoming Data (Webhooks).");
  }

  const lead = webhookLeadFields(params);
  if (!lead) {
    return htmlPage(400, "Nothing to save", "The lead needs at least a name, phone number, or email.");
  }

  const result = await insertLead(admin, companyId, lead);
  if ("error" in result) {
    return htmlPage(500, "Could not save the lead", result.error);
  }

  const who =
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
    lead.phone ||
    lead.email ||
    "The lead";
  return htmlPage(200, "✓ Lead added", `${who} is now in the pipeline, in the Unsorted stage. You can close this tab.`);
}

// Observability rollout (TECH_DEBT -> DECISIONS #031): timing, correlation
// id, and Sentry capture for every run, same wrapper as the dialer path.
export const POST = withRouteObservability("api.leads.webhook", handlePost);
export const GET = withRouteObservability("api.leads.webhook", handleGet);
