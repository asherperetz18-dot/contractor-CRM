import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyNewLead } from "@/lib/notify-new-lead";
import {
  webhookLeadConfirmation,
  webhookLeadFields,
  type WebhookLeadFields,
} from "@/lib/webhook-lead";
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The GET door and the review form exist for dialer "web form" buttons --
// ViciDial can only open a URL in the agent's browser, appending the
// lead's fields to the query string. The reader is that agent, mid-call,
// so every answer on this path is a plain page, not JSON.
function pageShell(title: string, inner: string) {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;background:#F7F5EF;color:#1F2937;margin:0;padding:32px 16px">` +
    `<div style="max-width:460px;margin:0 auto">${inner}</div>` +
    `</body></html>`
  );
}

function htmlPage(status: number, heading: string, detail: string) {
  return new NextResponse(
    pageShell(
      heading,
      `<div style="text-align:center;padding-top:24px"><h1 style="font-size:22px">${escapeHtml(heading)}</h1>` +
        `<p style="color:#4B5563">${escapeHtml(detail)}</p></div>`
    ),
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

const inputStyle =
  "width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #D6D0C1;border-radius:6px;background:#fff;font-size:15px;font-family:inherit";
const labelStyle =
  "display:block;font-size:12px;color:#6B7280;margin:12px 0 4px";

function field(label: string, name: string, value: string, mode = "text") {
  return (
    `<label style="${labelStyle}">${escapeHtml(label)}</label>` +
    `<input name="${name}" value="${escapeHtml(value)}" inputmode="${mode}" style="${inputStyle}">`
  );
}

/**
 * The check-and-save form (`&review=1`): everything ViciDial appended to
 * the URL arrives pre-filled, the agent fixes or adds what the call
 * surfaced, and Save posts it through the same POST door as every other
 * source (`respond=html` turns that door's answer into a page). Plain
 * HTML, no script -- it must render inside ViciDial's iframe under the
 * app's CSP with nothing to hydrate.
 */
function reviewFormPage(
  key: string,
  prefill: WebhookLeadFields | null,
  raw: { value: string; source: string },
  projectTypes: string[]
) {
  const p = prefill;
  const typeOptions = [
    prefill?.project_type && !projectTypes.includes(prefill.project_type)
      ? prefill.project_type
      : null,
    ...projectTypes,
  ].filter((t): t is string => Boolean(t));
  const projectField = typeOptions.length
    ? `<label style="${labelStyle}">Project type</label>` +
      `<select name="project_type" style="${inputStyle}">` +
      `<option value=""></option>` +
      typeOptions
        .map(
          (t) =>
            `<option value="${escapeHtml(t)}"${t === p?.project_type ? " selected" : ""}>${escapeHtml(t)}</option>`
        )
        .join("") +
      `</select>`
    : field("Project type", "project_type", p?.project_type || "");

  const inner =
    `<h1 style="font-size:20px;margin:0 0 2px">New lead — check &amp; save</h1>` +
    `<p style="font-size:13px;color:#6B7280;margin:0 0 8px">Fix anything the dialer got wrong, add what the call turned up, then save.</p>` +
    `<form method="post" action="/api/leads/webhook?key=${encodeURIComponent(key)}&amp;respond=html">` +
    (raw.source ? `<input type="hidden" name="source" value="${escapeHtml(raw.source)}">` : "") +
    `<div style="display:flex;gap:10px"><div style="flex:1">${field("First name", "first_name", p?.first_name || "")}</div>` +
    `<div style="flex:1">${field("Last name", "last_name", p?.last_name || "")}</div></div>` +
    `<div style="display:flex;gap:10px"><div style="flex:1">${field("Phone", "phone", p?.phone || "", "tel")}</div>` +
    `<div style="flex:1">${field("Alt phone", "phone2", p?.phone2 || "", "tel")}</div></div>` +
    field("Email", "email", p?.email || "", "email") +
    `<div style="display:flex;gap:10px"><div style="flex:2">${field("Address", "address", p?.address || "")}</div>` +
    `<div style="flex:1">${field("Zip", "zip", p?.zip || "", "numeric")}</div></div>` +
    projectField +
    field("Est. value ($)", "value", raw.value, "decimal") +
    `<label style="${labelStyle}">Notes</label>` +
    `<textarea name="notes" rows="4" style="${inputStyle};resize:vertical">${escapeHtml(p?.notes || "")}</textarea>` +
    `<button type="submit" style="width:100%;margin-top:16px;padding:12px;border:0;border-radius:6px;background:#1F2937;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Save lead</button>` +
    `<p style="font-size:12px;color:#9CA3AF;text-align:center;margin-top:10px">Saves into the Pipeline&#39;s Unsorted stage.</p>` +
    `</form>`;

  return new NextResponse(pageShell("New lead — check & save", inner), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function projectTypeNames(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string
): Promise<string[]> {
  // Best-effort: a failed read just means the form falls back to a free
  // text input, same as a company with no types configured.
  const { data } = await admin
    .from("project_types")
    .select("name")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true });
  return ((data as { name: string }[] | null) ?? [])
    .map((r) => r.name)
    .filter(Boolean);
}

async function handlePost(req: NextRequest) {
  const admin = createAdminClient();
  const wantsHtml = req.nextUrl.searchParams.get("respond") === "html";
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    if (wantsHtml) return htmlPage(401, "Link not recognized", "This lead link is missing its key. Copy a fresh URL from Settings › Incoming Data (Webhooks).");
    return NextResponse.json({ error: "Missing ?key=" }, { status: 401 });
  }
  const companyId = await companyForKey(admin, key);
  if (!companyId) {
    if (wantsHtml) return htmlPage(401, "Link not recognized", "The key on this lead link is wrong or was regenerated. Copy a fresh URL from Settings › Incoming Data (Webhooks).");
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(req);
  } catch {
    if (wantsHtml) return htmlPage(400, "Nothing to save", "The form data could not be read. Go back and try again.");
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 });
  }

  const lead = webhookLeadFields(body);
  if (!lead) {
    if (wantsHtml) return htmlPage(400, "Nothing to save", "The lead needs at least a name, phone number, or email. Go back and fill one in.");
    return NextResponse.json(
      { error: "Provide at least a name, phone, or email." },
      { status: 400 }
    );
  }

  const result = await insertLead(admin, companyId, lead);
  if ("error" in result) {
    if (wantsHtml) return htmlPage(500, "Could not save the lead", result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (wantsHtml) {
    return htmlPage(200, "✓ Lead added", `${webhookLeadConfirmation(lead)} is now in the pipeline, in the Unsorted stage. You can close this tab.`);
  }
  return NextResponse.json({ ok: true, id: result.id, alerted: result.alerted });
}

async function handleGet(req: NextRequest) {
  const admin = createAdminClient();
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  delete params.key;
  delete params.review;

  const key = req.nextUrl.searchParams.get("key");
  const companyId = await companyForKey(admin, key);
  if (!key || !companyId) {
    return htmlPage(401, "Link not recognized", "This lead link is missing its key or the key was regenerated. Copy a fresh URL from Settings › Incoming Data (Webhooks).");
  }

  // `&review=1` shows the agent a pre-filled form to finish instead of
  // saving on sight -- the Web Form button's mode. Without it the GET
  // saves immediately, which background callers (ViciDial's Dispo Call
  // URL) depend on: nobody is there to press Save.
  if (req.nextUrl.searchParams.get("review")) {
    const prefill = webhookLeadFields(params);
    const types = await projectTypeNames(admin, companyId);
    return reviewFormPage(key, prefill, { value: params.value || "", source: params.source || "" }, types);
  }

  const lead = webhookLeadFields(params);
  if (!lead) {
    return htmlPage(400, "Nothing to save", "The lead needs at least a name, phone number, or email.");
  }

  const result = await insertLead(admin, companyId, lead);
  if ("error" in result) {
    return htmlPage(500, "Could not save the lead", result.error);
  }

  return htmlPage(200, "✓ Lead added", `${webhookLeadConfirmation(lead)} is now in the pipeline, in the Unsorted stage. You can close this tab.`);
}

// Observability rollout (TECH_DEBT -> DECISIONS #031): timing, correlation
// id, and Sentry capture for every run, same wrapper as the dialer path.
export const POST = withRouteObservability("api.leads.webhook", handlePost);
export const GET = withRouteObservability("api.leads.webhook", handleGet);
