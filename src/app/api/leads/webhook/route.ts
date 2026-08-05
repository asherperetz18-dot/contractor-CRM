import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyNewLead } from "@/lib/notify-new-lead";

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

  // No session here (public webhook), so the key has to do two jobs: prove
  // the caller is allowed in, and say which company's pipeline the lead
  // belongs to. Looking the company up BY the secret does both.
  //
  // This used to read "the one company_profile row" with .single() and
  // compare secrets in JS. The moment a second company existed, .single()
  // started erroring on multiple rows, so every key -- including valid
  // ones -- came back "Invalid key".
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("webhook_secret", key)
    .maybeSingle();

  const companyId = (company as { company_id: string } | null)?.company_id;
  if (!companyId) {
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
      // Required since leads.company_id became NOT NULL. Without it every
      // authenticated call still failed, just at the insert instead.
      company_id: companyId,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // After the insert, and never allowed to fail it: the lead is safely
  // saved by this point, and a Twilio problem must not return an error
  // that makes Zapier or Meta retry a lead that landed fine.
  const alert = await notifyNewLead(admin, {
    companyId,
    firstName,
    lastName,
    phone,
    email,
    address: body.address || null,
    projectType: body.project_type || body.projectType || null,
    source: body.source || "Website",
    notes: body.message || body.notes || null,
  }).catch(() => ({ sent: 0, skipped: "alert failed" }));

  return NextResponse.json({ ok: true, id: (data as { id: string }).id, alerted: alert.sent });
}
