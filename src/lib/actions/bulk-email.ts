"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email-env";
import { getEmailForCompany } from "@/lib/email-company";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch } from "@/lib/data/types";
import { buildBulkEmailContent, resolveBulkEmailTargets } from "@/lib/bulk-email";

export type BulkEmailResult = {
  sent: string[];
  failed: { id: string; error: string }[];
  skipped: number;
  error?: string;
};

/**
 * Office-side: one message, sent individually to every selected contact
 * that has an email on file.
 *
 * Sequential, not Promise.all -- a large selection must not burst the
 * Resend API, and one bad address must never stop the rest of the batch.
 */
export async function sendBulkEmail(
  leadIds: string[],
  subject: string,
  message: string
): Promise<BulkEmailResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canEditDispatch(profile)) {
    return { sent: [], failed: [], skipped: 0, error: "You don't have permission to email contacts." };
  }
  if (!subject.trim() || !message.trim()) {
    return { sent: [], failed: [], skipped: 0, error: "Enter a subject and a message." };
  }
  if (leadIds.length === 0) {
    return { sent: [], failed: [], skipped: 0, error: "No contacts selected." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, email")
    .eq("company_id", profile.company_id)
    .in("id", leadIds);
  const leads = (data as { id: string; email: string | null }[] | null) ?? [];

  const { targets, skipped } = resolveBulkEmailTargets(leads);
  if (targets.length === 0) {
    return {
      sent: [],
      failed: [],
      skipped,
      error: "None of the selected contacts have an email on file.",
    };
  }

  const emailEnv = await getEmailForCompany(profile.company_id);
  const { subject: cleanSubject, html, text } = buildBulkEmailContent(subject, message);

  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const target of targets) {
    const result = await sendEmail(target.email, cleanSubject, html, text, {
      env: emailEnv ?? undefined,
    });
    if (result.error) {
      failed.push({ id: target.id, error: result.error });
      continue;
    }
    sent.push(target.id);
    // Same activity trail the portal-link send uses, so "did they ever
    // get anything?" stays answerable from one table instead of two.
    await admin.from("sms_messages").insert({
      lead_id: target.id,
      direction: "outbound",
      from_number: "email",
      to_number: target.email,
      sent_by: profile.id,
      body: `[Bulk email] ${cleanSubject}`,
      twilio_sid: result.id || null,
      company_id: profile.company_id,
      channel: "email",
    });
  }

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return { sent, failed, skipped };
}
