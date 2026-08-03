"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email-env";
import { getTwilioEnv, sendTwilioSms } from "@/lib/twilio-env";
import {
  completeChallenge,
  createLoginToken,
  destroyPortalSession,
  getPortalViewer,
  portalAccessActive,
  portalAccessExpiry,
} from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { leadDisplayName, type Lead } from "@/lib/data/types";

const MAX_PORTAL_UPLOAD_BYTES = 10 * 1024 * 1024;
const BUCKET = "lead-files";

function portalBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/**
 * Emails a sign-in link to a customer.
 *
 * Always reports success, even when no lead matches. Saying "no account
 * with that email" would turn this form into a way for anyone to test
 * whether a given person is a customer of this contractor.
 */
export async function requestPortalLink(email: string): Promise<{ sent: boolean; error?: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    return { sent: false, error: "Enter a valid email address." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select(
      "id, company_id, first_name, last_name, company_name, contact_type, email, portal_access_expires_at"
    )
    .ilike("email", trimmed)
    .limit(1);

  const lead = (data as Lead[] | null)?.[0];
  if (!lead) return { sent: true };

  // Self-service can't reopen expired access -- that's the office's call.
  // Reported as success anyway, since a distinct "your access expired"
  // reply would confirm to a stranger that this person is a customer.
  if (!portalAccessActive(lead.portal_access_expires_at)) return { sent: true };

  const { token, error } = await createLoginToken(lead.id, lead.company_id);
  if (error || !token) return { sent: true };

  const { data: companyRow } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", lead.company_id)
    .maybeSingle();
  const companyName = (companyRow as { name: string | null } | null)?.name || "your contractor";

  const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}`;
  const mail = buildPortalEmail(lead.first_name, companyName, link);

  const result = await sendEmail(trimmed, mail.subject, mail.html, mail.text);
  if (result.error) return { sent: false, error: result.error };
  return { sent: true };
}

function buildPortalEmail(firstName: string | null, companyName: string, link: string) {
  const greeting = firstName || "there";
  return {
    subject: `Your ${companyName} project portal sign-in link`,
    text: [
      `Hi ${greeting},`,
      ``,
      `Here's your sign-in link for your project portal with ${companyName}:`,
      link,
      ``,
      `This link works once and expires in 30 minutes.`,
      `If you didn't request it, you can ignore this email.`,
    ].join("\n"),
    html: `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1a1a1a">
      <p>Hi ${greeting},</p>
      <p>Here's your sign-in link for your project portal with <strong>${companyName}</strong>:</p>
      <p><a href="${link}" style="display:inline-block;background:#C2410C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open my project portal</a></p>
      <p style="color:#666;font-size:13px">This link works once and expires in 30 minutes. If you didn't request it, you can ignore this email.</p>
    </div>
  `,
  };
}

async function companyNameFor(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string
): Promise<string> {
  const { data } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as { name: string | null } | null)?.name || "your contractor";
}

/**
 * Staff-side: send a customer their portal link by email and/or text,
 * whichever they have on file. Reports back which channels actually went
 * out, so "Sent" never overstates what happened.
 */
export async function sendPortalLink(
  leadId: string
): Promise<{ error?: string; channels?: string[]; expiresAt?: string }> {
  const admin = createAdminClient();
  const { data } = await admin.from("leads").select("*").eq("id", leadId).maybeSingle();
  const lead = data as Lead | null;
  if (!lead) return { error: "Contact not found." };
  if (!lead.phone && !lead.email) {
    return { error: "This contact has no phone or email on file." };
  }

  const companyName = await companyNameFor(admin, lead.company_id);
  const channels: string[] = [];
  const problems: string[] = [];

  // Sending someone their portal link is the act of granting access, so it
  // starts (or restarts) the 10-day clock. Otherwise a customer could be
  // sent a link that refuses to let them in.
  const grantedUntil = portalAccessExpiry();
  await admin
    .from("leads")
    .update({ portal_access_expires_at: grantedUntil })
    .eq("id", lead.id);

  if (lead.email) {
    const { token, error } = await createLoginToken(lead.id, lead.company_id);
    if (error || !token) {
      problems.push("couldn't create an email sign-in link");
    } else {
      const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}`;
      const mail = buildPortalEmail(lead.first_name, companyName, link);
      const sent = await sendEmail(lead.email, mail.subject, mail.html, mail.text);
      if (sent.error) {
        problems.push(`email failed (${sent.error})`);
      } else {
        channels.push("email");
        // Logged alongside texts so "did they ever get anything?" is
        // answerable from data. Without this an email send leaves no
        // trace at all and there is nothing to check afterwards.
        await admin.from("sms_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          from_number: "email",
          to_number: lead.email,
          body: `[Portal sign-in link emailed] ${mail.subject}`,
          twilio_sid: sent.id || null,
          company_id: lead.company_id,
          channel: "email",
        });
      }
    }
  }

  const twilioEnv = getTwilioEnv();
  if (lead.phone && twilioEnv) {
    // A separate token per channel -- these are single-use, so one shared
    // token would silently break whichever link the customer opened second.
    const { token, error } = await createLoginToken(lead.id, lead.company_id);
    if (error || !token) {
      problems.push("couldn't create a text sign-in link");
    } else {
      const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}`;
      const body = `${companyName}: here's your project portal — see your appointments, photos and messages.\n${link}\n\nLink expires in 30 minutes.`;
      const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
      if (sent.error) {
        problems.push(`text failed (${sent.error})`);
      } else {
        channels.push("text");
        await admin.from("sms_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          from_number: twilioEnv.phoneNumber,
          to_number: lead.phone,
          body,
          twilio_sid: sent.sid || null,
          company_id: lead.company_id,
          channel: "sms",
        });
      }
    }
  }

  if (channels.length === 0) {
    return { error: problems.join("; ") || "Couldn't send the portal link." };
  }
  return { channels, expiresAt: grantedUntil };
}

/**
 * Office-side renewal of a customer's portal access. Sending them a link
 * also renews, but this exists for the common case of extending access for
 * someone who still has a working link or session.
 */
export async function renewPortalAccess(
  leadId: string
): Promise<{ error?: string; expiresAt?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) {
    return { error: "You don't have permission to do that." };
  }

  const admin = createAdminClient();
  const expiresAt = portalAccessExpiry();
  const { error } = await admin
    .from("leads")
    .update({ portal_access_expires_at: expiresAt })
    // Scoped to the caller's own company so a leadId from another tenant
    // can't be extended.
    .eq("id", leadId)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return { expiresAt };
}

/** Office-side: close a customer's portal off immediately. */
export async function revokePortalAccess(leadId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) {
    return { error: "You don't have permission to do that." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update({ portal_access_expires_at: null })
    .eq("id", leadId)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  // Live sessions are checked against this on every page load, so clearing
  // the grant is enough -- no need to hunt down session rows.
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

/** Second sign-in step: the street number of the project address. */
export async function answerPortalChallenge(
  answer: string
): Promise<{ error?: string; remaining?: number }> {
  return completeChallenge(answer);
}

export async function portalSignOut(): Promise<void> {
  await destroyPortalSession();
  redirect("/portal");
}

/** Customer confirming or declining their own appointment. */
export async function portalSetAppointmentConfirmed(
  eventId: string,
  confirmed: boolean
): Promise<{ error?: string }> {
  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Please sign in again." };

  const admin = createAdminClient();
  // Scoped to this customer's own lead so a guessed event id can't be
  // touched from someone else's portal session.
  const { data: owned } = await admin
    .from("events")
    .select("id, title")
    .eq("id", eventId)
    .eq("lead_id", viewer.lead.id)
    .maybeSingle();
  if (!owned) return { error: "That appointment isn't available." };

  const { error } = await admin
    .from("events")
    .update({ customer_confirmed: confirmed })
    .eq("id", eventId);
  if (error) return { error: error.message };

  await admin.from("lead_notes").insert({
    lead_id: viewer.lead.id,
    author_id: null,
    body: `${confirmed ? "✅" : "❌"} Client ${
      confirmed ? "confirmed" : "declined"
    } via the client portal.`,
    event_id: eventId,
    company_id: viewer.companyId,
  });

  revalidatePath("/portal/home");
  return {};
}

/** Customer asking for a different time -- becomes a task for the team. */
export async function portalRequestReschedule(
  eventId: string,
  note: string
): Promise<{ error?: string }> {
  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Please sign in again." };

  const admin = createAdminClient();
  const { data: owned } = await admin
    .from("events")
    .select("id, title, date, assigned_to")
    .eq("id", eventId)
    .eq("lead_id", viewer.lead.id)
    .maybeSingle();
  const event = owned as { id: string; title: string | null; date: string; assigned_to: string | null } | null;
  if (!event) return { error: "That appointment isn't available." };

  const { error } = await admin.from("lead_tasks").insert({
    lead_id: viewer.lead.id,
    title: `Reschedule requested: ${event.title || "appointment"}${
      note.trim() ? ` — "${note.trim()}"` : ""
    }`,
    due_date: new Date().toISOString().slice(0, 10),
    assigned_to: event.assigned_to,
    company_id: viewer.companyId,
  });
  if (error) return { error: error.message };

  await admin.from("lead_notes").insert({
    lead_id: viewer.lead.id,
    author_id: null,
    body: `📅 Client requested a reschedule via the client portal${
      note.trim() ? `: "${note.trim()}"` : "."
    }`,
    event_id: eventId,
    company_id: viewer.companyId,
  });

  revalidatePath("/portal/home");
  return {};
}

/** Customer sending a message -- lands in the team's Reply Inbox thread. */
export async function portalSendMessage(body: string): Promise<{ error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Type a message first." };

  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Please sign in again." };

  const twilioEnv = getTwilioEnv();
  const admin = createAdminClient();
  const { error } = await admin.from("sms_messages").insert({
    lead_id: viewer.lead.id,
    direction: "inbound",
    from_number: viewer.lead.phone || "portal",
    to_number: twilioEnv?.phoneNumber || "portal",
    body: trimmed,
    company_id: viewer.companyId,
    channel: "portal",
  });
  if (error) return { error: error.message };

  revalidatePath("/portal/home");
  return {};
}

/** Customer uploading a photo of their project. */
export async function portalUploadFile(formData: FormData): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "No file selected." };
  if (file.size > MAX_PORTAL_UPLOAD_BYTES) {
    return { error: "That file is too large — please use one under 10MB." };
  }

  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Please sign in again." };

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${viewer.lead.id}/portal-${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  // uploaded_by is a staff profiles FK, so a customer upload leaves it
  // null -- that null is what marks a file as client-supplied.
  const { error } = await admin.from("lead_files").insert({
    lead_id: viewer.lead.id,
    uploaded_by: null,
    file_name: file.name,
    file_path: path,
    file_url: pub?.publicUrl ?? null,
    file_size: file.size,
    content_type: file.type || null,
    storage_provider: "supabase",
    company_id: viewer.companyId,
  });
  if (error) return { error: error.message };

  await admin.from("lead_notes").insert({
    lead_id: viewer.lead.id,
    author_id: null,
    body: `📎 ${leadDisplayName(viewer.lead)} uploaded "${file.name}" via the client portal.`,
    company_id: viewer.companyId,
  });

  revalidatePath("/portal/home");
  return {};
}
