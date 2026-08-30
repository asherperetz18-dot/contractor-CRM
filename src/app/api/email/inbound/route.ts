import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailEnv } from "@/lib/email-env";
import { leadForPhoneNumber } from "@/lib/data/lead-for-number";
import { notifyNewLead } from "@/lib/notify-new-lead";
import { parseLeadEmail } from "@/lib/inbound-email";

/**
 * Where forwarded lead emails become leads.
 *
 * Resend receives mail for the platform's inbound domain and posts an
 * email.received event here. The address's local part carries the
 * company token (leads-<token>@...), which is how a multi-tenant
 * mailbox knows whose pipeline the lead belongs to. The webhook holds
 * only metadata; the body is fetched from Resend's API afterwards --
 * by design, so the request stays small.
 */

/** Svix-style verification, per Resend's webhook signing. */
function verifySvix(secret: string, rawBody: string, headers: Headers): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;

  // Replays are cheap to forge once a signed payload leaks; five
  // minutes of tolerance is svix's own recommendation.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const a = Buffer.from(expected);
  return signatures.split(" ").some((entry) => {
    const sig = entry.startsWith("v1,") ? entry.slice(3) : entry;
    const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

type ReceivedEvent = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
  };
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RESEND_INBOUND_SECRET not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifySvix(secret, rawBody, req.headers)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: ReceivedEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  if (event.type !== "email.received") return NextResponse.json({ ok: true, skipped: "not email.received" });

  const data = event.data ?? {};
  // The company rides in the local part of whichever of our addresses
  // received it (to for direct sends, received_for for forwards).
  const recipients = [...(data.to ?? []), ...(data.received_for ?? [])].join(" ").toLowerCase();
  const token = recipients.match(/leads-([a-z0-9]{12,64})@/)?.[1];
  if (!token) return NextResponse.json({ ok: true, skipped: "no company token in recipient" });

  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("inbound_email_token", token)
    .maybeSingle<{ company_id: string }>();
  if (!company) return NextResponse.json({ ok: true, skipped: "unknown token" });
  const companyId = company.company_id;

  // The body lives behind Resend's API, fetched with the platform key
  // (the receiving domain belongs to the platform's Resend account).
  const env = getEmailEnv();
  if (!data.email_id) return NextResponse.json({ ok: true, skipped: "no email id" });
  if (!env) {
    // A config gap, not a bad email -- a 5xx makes Resend retry for
    // ~18 hours, which is time to fix RESEND_API_KEY without losing
    // the lead.
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }
  const bodyRes = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`,
    { headers: { Authorization: `Bearer ${env.apiKey}` } }
  ).catch(() => null);
  if (!bodyRes?.ok) {
    // Non-200 makes Resend retry (7 attempts over ~18h) -- right call
    // for a transient fetch failure, since the email is safe on their
    // side for 30 days. The upstream status is echoed because it names
    // the fix: a 401 here means the API key lacks full access.
    const upstream = bodyRes ? `${bodyRes.status} ${(await bodyRes.text().catch(() => "")).slice(0, 120)}` : "network error";
    return NextResponse.json(
      { error: "could not fetch email body", upstream },
      { status: 502 }
    );
  }
  const email = (await bodyRes.json()) as {
    from?: string;
    subject?: string;
    text?: string | null;
    html?: string | null;
  };

  const parsed = parseLeadEmail({
    from: email.from ?? data.from ?? "",
    subject: email.subject ?? data.subject ?? "",
    text: email.text ?? null,
    html: email.html ?? null,
  });

  try {
    // A sender we already know appends to the lead instead of
    // duplicating them -- same manners as the CallRail intake.
    let existingId = parsed.phone ? await leadForPhoneNumber(admin, companyId, parsed.phone) : null;
    if (!existingId && parsed.email) {
      const { data: byEmail } = await admin
        .from("leads")
        .select("id")
        .eq("company_id", companyId)
        .ilike("email", parsed.email)
        .limit(2);
      const rows = (byEmail as { id: string }[]) ?? [];
      existingId = rows.length === 1 ? rows[0].id : null;
    }

    if (existingId) {
      const { data: row } = await admin
        .from("leads")
        .select("notes")
        .eq("id", existingId)
        .maybeSingle<{ notes: string | null }>();
      const prev = (row?.notes ?? "").trim();
      const stamped = `${new Date().toISOString().slice(0, 10)} — Emailed in via ${parsed.source}:\n${(parsed.message ?? "").slice(0, 800)}`;
      await admin
        .from("leads")
        .update({ notes: prev ? `${prev}\n\n${stamped}` : stamped })
        .eq("id", existingId);
      return NextResponse.json({ ok: true, noted: existingId });
    }

    if (!parsed.name && !parsed.phone && !parsed.email) {
      // Nothing identifies a person -- a newsletter or a receipt, not a
      // lead. Acknowledged and dropped rather than polluting Unsorted.
      return NextResponse.json({ ok: true, skipped: "no contact details found" });
    }

    const [first, ...rest] = (parsed.name ?? "").trim().split(/\s+/);
    const { data: lead, error } = await admin
      .from("leads")
      .insert({
        contact_type: "Individual",
        first_name: first || null,
        last_name: rest.join(" ") || null,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        project_type: parsed.projectType,
        notes: parsed.message,
        stage: "Unsorted",
        source: parsed.source,
        company_id: companyId,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Live lead, live alert -- and never allowed to fail the ingest.
    await notifyNewLead(admin, {
      companyId,
      firstName: first ?? "",
      lastName: rest.join(" "),
      phone: parsed.phone ?? "",
      email: parsed.email ?? "",
      address: parsed.address,
      projectType: parsed.projectType,
      source: parsed.source,
      notes: parsed.message,
    }).catch(() => ({ sent: 0 }));

    return NextResponse.json({ ok: true, created: (lead as { id: string }).id });
  } catch (e) {
    console.error("inbound email processing failed", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
