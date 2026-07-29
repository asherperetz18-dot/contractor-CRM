import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

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

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing ?key=" }, { status: 401 });
  }

  // No session here (public webhook) -- there's exactly one company today,
  // so this is the one company_profile row and leads.insert() below gets
  // company_id from the single-company trigger fallback. Once a second
  // company exists this needs a per-company secret/route.
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("webhook_secret")
    .single();

  const secret = (company as { webhook_secret: string | null } | null)?.webhook_secret;
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(req);
  } catch {
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 });
  }

  const fullName = body.name || body.full_name || "";
  const { first, last } = fullName ? splitName(fullName) : { first: "", last: "" };
  const firstName = body.first_name || body.firstName || first;
  const lastName = body.last_name || body.lastName || last;
  const phone = body.phone || body.phone_number || "";
  const email = body.email || "";

  if (!firstName && !lastName && !phone && !email) {
    return NextResponse.json(
      { error: "Provide at least a name, phone, or email." },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      contact_type: "Individual",
      first_name: firstName || null,
      last_name: lastName || null,
      phone: phone || null,
      email: email || null,
      address: body.address || null,
      project_type: body.project_type || body.projectType || null,
      notes: body.message || body.notes || null,
      value: Number(body.value) || 0,
      stage: "Unsorted",
      source: body.source || "Website",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
