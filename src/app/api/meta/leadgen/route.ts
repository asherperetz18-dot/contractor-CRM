import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyNewLead } from "@/lib/notify-new-lead";
import { withRouteObservability } from "@/lib/observability/observe";
import { GRAPH_VERSION, verifyMetaSignature, webhookSignatureCheck } from "@/lib/meta/facebook-login";

type MetaConfig = {
  company_id: string;
  meta_page_id: string | null;
  meta_page_access_token: string | null;
  meta_verify_token: string | null;
  meta_app_secret: string | null;
  /** 'facebook_login' when connected through the CRM's own app (0178). */
  meta_connected_via: string | null;
};

// No session here (public webhook), so the incoming payload has to say
// which company it belongs to. Meta gives us the Facebook Page id, which
// each company stores against itself.
//
// This used to read "the one company_profile row" with .single(). Once a
// second company existed that failed with PGRST116 and returned null, so
// the route reported "not configured" and dropped every lead on the
// floor, and the verification handshake answered 403.
const CONFIG_COLUMNS =
  "company_id, meta_page_id, meta_page_access_token, meta_verify_token, meta_app_secret";

async function getMetaConfigByPage(pageId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .select(`${CONFIG_COLUMNS}, meta_connected_via`)
    .eq("meta_page_id", pageId)
    .maybeSingle();
  if (!error) return data as MetaConfig | null;
  // Migration 0178 not run yet: every Page is still a manual one, and a
  // missing column must never drop the lead.
  const { data: legacy } = await admin
    .from("company_profile")
    .select(CONFIG_COLUMNS)
    .eq("meta_page_id", pageId)
    .maybeSingle();
  return legacy ? ({ ...legacy, meta_connected_via: null } as MetaConfig) : null;
}

async function getMetaConfigByVerifyToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("meta_verify_token", token)
    .maybeSingle();
  return data;
}

// Meta calls this once, when you register the webhook, to confirm you
// control this URL. Must echo back hub.challenge as plain text.
async function handleGet(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  // The CRM's own app (Connect with Facebook) registers once with the
  // deployment's token; a manually set-up app uses its company's own.
  const platformToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const verified =
    Boolean(token && platformToken && token === platformToken) ||
    Boolean(token && (await getMetaConfigByVerifyToken(token)));

  if (mode === "subscribe" && verified) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

type MetaLeadgenChange = {
  field: string;
  value: { leadgen_id: string; page_id: string; form_id: string };
};
type MetaEntry = { id: string; changes: MetaLeadgenChange[] };
type MetaWebhookPayload = { object: string; entry: MetaEntry[] };

async function fetchLeadFields(leadgenId: string, pageAccessToken: string) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const fields: Record<string, string> = {};
  for (const f of json.field_data ?? []) {
    fields[f.name] = (f.values ?? [])[0] ?? "";
  }
  return fields;
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

async function handlePost(req: NextRequest) {
  const rawBody = await req.text();

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  let created = 0;
  let alerted = 0;

  for (const entry of payload.entry ?? []) {
    // Parsed before the signature check only to learn which Page this is
    // for -- nothing from the body is trusted until that check passes,
    // and which secret signs it depends on how the Page was connected.
    const pageId = entry.changes?.find((c) => c.value?.page_id)?.value.page_id ?? entry.id;
    if (!pageId) continue;

    const config = await getMetaConfigByPage(String(pageId));
    if (!config?.meta_page_access_token) {
      // Unknown or unconfigured Page. Acknowledged rather than errored so
      // Meta doesn't retry forever or disable the subscription.
      continue;
    }

    const check = webhookSignatureCheck(config, process.env.META_APP_SECRET);
    if (
      check.kind === "reject" ||
      (check.kind === "verify" &&
        !verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), check.secret))
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) continue;

      const fields = await fetchLeadFields(leadgenId, config.meta_page_access_token);
      if (!fields) continue;

      const fullName = fields.full_name || fields.name || "";
      const { first, last } = fullName ? splitName(fullName) : { first: "", last: "" };
      const lead = {
        firstName: fields.first_name || first || null,
        lastName: fields.last_name || last || null,
        phone: fields.phone_number || fields.phone || null,
        email: fields.email || null,
        address: fields.street_address || fields.city || null,
      };

      const { error } = await admin.from("leads").insert({
        contact_type: "Individual",
        first_name: lead.firstName,
        last_name: lead.lastName,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        zip: fields.zip_code || null,
        stage: "Unsorted",
        source: "Facebook Lead Ads",
        // leads.company_id is NOT NULL. Without this every insert failed
        // -- and the result was never checked, so it failed in silence.
        company_id: config.company_id,
      });
      if (error) {
        console.error("meta leadgen insert failed", error.message);
        continue;
      }
      created += 1;

      const alert = await notifyNewLead(admin, {
        companyId: config.company_id,
        ...lead,
        projectType: null,
        source: "Facebook Lead Ads",
        notes: null,
      }).catch(() => ({ sent: 0 }));
      alerted += alert.sent;
    }
  }

  return NextResponse.json({ ok: true, created, alerted });
}

// Observability rollout (TECH_DEBT -> DECISIONS #031): timing, correlation
// id, and Sentry capture for every run, same wrapper as the dialer path.
export const GET = withRouteObservability("api.meta.leadgen.verify", handleGet);
export const POST = withRouteObservability("api.meta.leadgen", handlePost);
