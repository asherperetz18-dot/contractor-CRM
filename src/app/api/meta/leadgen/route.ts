import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GRAPH_VERSION = "v21.0";

type MetaConfig = {
  meta_page_id: string | null;
  meta_page_access_token: string | null;
  meta_verify_token: string | null;
  meta_app_secret: string | null;
};

async function getMetaConfig() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("meta_page_id, meta_page_access_token, meta_verify_token, meta_app_secret")
    .eq("id", 1)
    .single();
  return data as MetaConfig | null;
}

// Meta calls this once, when you register the webhook, to confirm you
// control this URL. Must echo back hub.challenge as plain text.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const config = await getMetaConfig();

  if (mode === "subscribe" && token && config?.meta_verify_token && token === config.meta_verify_token) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const config = await getMetaConfig();

  if (config?.meta_app_secret) {
    const sig = req.headers.get("x-hub-signature-256");
    if (!verifySignature(rawBody, sig, config.meta_app_secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  if (!config?.meta_page_access_token) {
    // Not configured yet -- acknowledge so Meta doesn't retry/disable the
    // subscription, but don't attempt to process.
    return NextResponse.json({ ok: true, skipped: "not configured" });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) continue;

      const fields = await fetchLeadFields(leadgenId, config.meta_page_access_token);
      if (!fields) continue;

      const fullName = fields.full_name || fields.name || "";
      const { first, last } = fullName ? splitName(fullName) : { first: "", last: "" };

      await admin.from("leads").insert({
        contact_type: "Individual",
        first_name: fields.first_name || first || null,
        last_name: fields.last_name || last || null,
        phone: fields.phone_number || fields.phone || null,
        email: fields.email || null,
        address: fields.street_address || fields.city || null,
        zip: fields.zip_code || null,
        stage: "Unsorted",
        source: "Facebook Lead Ads",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
