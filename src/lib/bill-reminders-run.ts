import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data/select-all";
import {
  INVOICE_DOC_COLUMNS,
  INVOICE_PAYMENT_COLUMNS,
  INVOICE_STAGE_COLUMNS,
  buildInvoiceRows,
  type InvoiceDocLite,
  type InvoicePaymentLite,
  type InvoiceStageLite,
} from "@/lib/data/invoice-rows";
import { companyIanaZone } from "@/lib/data/types";
import { personName } from "@/lib/data/client-name";
import { addDays, isoDateInZone } from "@/lib/company-clock";
import { billChannelParts, billRecipients, sentViaOf, type BillChannel } from "@/lib/bill-email";
import {
  REMINDER_DAYS_BEFORE,
  REMINDER_STATUSES,
  inReminderHours,
  nextReminder,
  reminderMessage,
  type ReminderKind,
} from "@/lib/bill-reminder";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { getTwilioForSending } from "@/lib/twilio-company";
import { sendTwilioSms } from "@/lib/twilio-env";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";

/**
 * One company's turn of the payment-reminder job (DECISIONS #152).
 *
 * Reads only the bills that could be due a reminder -- billed, not
 * cancelled, not paused, due between 60 days ago and 3 days from now --
 * builds their status the way the Invoices page does, and sends each the
 * step `nextReminder` says it's due, by the company's channel. A step is
 * claimed (a `bill_reminders` row, unique per bill and step) before it
 * goes and released if nothing went, so it can never go twice.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ReminderCompany = {
  company_id: string;
  timezone: string | null;
  name: string | null;
  bill_reminder_channel: string | null;
};

/** A bill more than this late has had its three weekly reminders. */
const HORIZON_DAYS = 60;
/** Reminders per company per run; the rest go next hour. */
const MAX_PER_RUN = 200;
const IN_CHUNK = 150;

async function forChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

type ReminderLead = {
  id: string;
  contact_type: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  second_contact_email: string | null;
  portal_payments_disabled: boolean | null;
};

export async function runCompanyReminders(
  admin: Admin,
  company: ReminderCompany,
  now: Date = new Date()
): Promise<{ checked: number; sent: number }> {
  const companyId = company.company_id;
  const zone = companyIanaZone(company.timezone);
  // Office hours on the company's own clock; the job runs every hour.
  if (!inReminderHours(now, zone)) return { checked: 0, sent: 0 };
  const today = isoDateInZone(now, zone);
  const channel: BillChannel =
    company.bill_reminder_channel === "text" || company.bill_reminder_channel === "both"
      ? company.bill_reminder_channel
      : "email";

  type Stage = InvoiceStageLite & { sent_at: string | null };
  const stages = await selectAll<Stage>((f, t) =>
    admin
      .from("estimate_payments")
      .select(INVOICE_STAGE_COLUMNS)
      .eq("company_id", companyId)
      .not("requested_at", "is", null)
      .is("cancelled_at", null)
      .eq("reminders_paused", false)
      .gte("due_date", addDays(today, -HORIZON_DAYS))
      .lte("due_date", addDays(today, REMINDER_DAYS_BEFORE))
      .order("id")
      .range(f, t)
  );
  if (!stages.length) return { checked: 0, sent: 0 };

  const stageIds = stages.map((s) => s.id);
  const docIds = [...new Set(stages.map((s) => s.estimate_id))];
  const [docs, payments, reminders, undecidedRefunds] = await Promise.all([
    forChunks(docIds, (chunk) =>
      selectAll<InvoiceDocLite>((f, t) =>
        admin.from("estimates").select(INVOICE_DOC_COLUMNS).eq("company_id", companyId).in("id", chunk).order("id").range(f, t)
      )
    ),
    forChunks(stageIds, (chunk) =>
      selectAll<InvoicePaymentLite>((f, t) =>
        admin
          .from("portal_payments")
          .select(INVOICE_PAYMENT_COLUMNS)
          .eq("company_id", companyId)
          .in("estimate_payment_id", chunk)
          .order("id")
          .range(f, t)
      )
    ),
    forChunks(stageIds, (chunk) =>
      selectAll<{ estimate_payment_id: string; kind: ReminderKind; sent_at: string }>((f, t) =>
        admin
          .from("bill_reminders")
          .select("estimate_payment_id, kind, sent_at")
          .eq("company_id", companyId)
          .in("estimate_payment_id", chunk)
          .order("id")
          .range(f, t)
      )
    ),
    // Refunds made in Stripe that nobody has said are still owed (0210,
    // DECISIONS #155). Its own read: before 0210 there are none.
    forChunks(stageIds, (chunk) =>
      selectAll<{ estimate_payment_id: string }>((f, t) =>
        admin
          .from("portal_payments")
          .select("estimate_payment_id")
          .eq("company_id", companyId)
          .in("estimate_payment_id", chunk)
          .not("refund_of", "is", null)
          .is("refund_still_owed", null)
          .order("id")
          .range(f, t)
      )
    ),
  ]);
  // Money just went back on these: until the office says whether the
  // customer still owes it, no reminder asks them for it.
  const awaitingDecision = new Set(undecidedRefunds.map((r) => r.estimate_payment_id));

  // Owed, with nothing already on its way -- the Invoices page's statuses.
  const rows = buildInvoiceRows(docs, stages, payments, new Map(), today).filter(
    (r) => REMINDER_STATUSES.has(r.status) && r.owedCents > 0 && r.dueDate
  );
  if (!rows.length) return { checked: 0, sent: 0 };

  const leads = await forChunks([...new Set(rows.map((r) => r.leadId))], (chunk) =>
    selectAll<ReminderLead>((f, t) =>
      admin
        .from("leads")
        .select("id, contact_type, first_name, last_name, phone, email, second_contact_email, portal_payments_disabled")
        .eq("company_id", companyId)
        .in("id", chunk)
        .order("id")
        .range(f, t)
    )
  );
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const remindersByStage = new Map<string, { kind: ReminderKind; sent_at: string }[]>();
  for (const r of reminders) {
    const list = remindersByStage.get(r.estimate_payment_id) ?? [];
    list.push(r);
    remindersByStage.set(r.estimate_payment_id, list);
  }

  const want = billChannelParts(channel);
  // Asked for once per company, and only if a reminder is actually due.
  let senders: { twilio: Awaited<ReturnType<typeof getTwilioForSending>>; email: Awaited<ReturnType<typeof getEmailForCompany>> } | null = null;
  const companyName = company.name || "Your contractor";

  let sent = 0;
  for (const row of rows) {
    if (sent >= MAX_PER_RUN) break;
    const lead = leadById.get(row.leadId);
    const stage = stageById.get(row.id);
    // A customer billed outside the CRM has no Pay button to send them to.
    if (!lead || !stage || lead.portal_payments_disabled) continue;
    if (awaitingDecision.has(row.id)) continue;

    const past = remindersByStage.get(row.id) ?? [];
    // The last time the customer heard about this bill: the bill itself
    // (or its latest send) or a reminder.
    const lastTouch = Math.max(
      ...[stage.sent_at ?? stage.requested_at, ...past.map((p) => p.sent_at)]
        .filter((v): v is string => !!v)
        .map((v) => new Date(v).getTime())
    );
    const kind = nextReminder({
      dueDate: row.dueDate,
      today,
      sentKinds: past.map((p) => p.kind),
      lastTouchDay: Number.isFinite(lastTouch) ? isoDateInZone(new Date(lastTouch), zone) : null,
    });
    if (!kind) continue;

    senders ??= {
      twilio: want.text ? await getTwilioForSending(companyId) : null,
      email: want.email ? await getEmailForCompany(companyId) : null,
    };
    const recipients = billRecipients(lead.email, lead.second_contact_email);
    const canText = !!(senders.twilio && lead.phone);
    const canEmail = !!(senders.email && recipients.to.length);
    if (!canText && !canEmail) continue;

    // Claimed before it goes: the unique (bill, step) refuses a second.
    const { data: claim, error: claimError } = await admin
      .from("bill_reminders")
      .insert({ company_id: companyId, estimate_payment_id: row.id, kind })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (claimError || !claim) continue;
    const release = () => admin.from("bill_reminders").delete().eq("id", claim.id);

    // The link signs them in, as the bill's own does.
    await admin.from("leads").update({ portal_access_expires_at: portalAccessExpiry() }).eq("id", lead.id).eq("company_id", companyId);
    const { token } = await createLoginToken(lead.id, companyId);
    if (!token) {
      await release();
      continue;
    }
    const next = encodeURIComponent(`/portal/estimates/${row.docId}`);
    const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}&next=${next}`;

    const message = reminderMessage({
      kind,
      companyName,
      customerName: personName(lead) || null,
      isInvoice: row.isInvoice,
      docNumber: row.docNumber,
      title: docById.get(row.docId)?.title ?? null,
      stageName: row.stage,
      owedCents: row.owedCents,
      dueDate: row.dueDate!,
      today,
      link,
    });

    const logRows: { from_number: string; to_number: string; body: string; twilio_sid: string | null; channel: string }[] = [];
    let texted = false;
    let emailed = false;
    if (canText && senders.twilio && lead.phone) {
      const res = await sendTwilioSms(lead.phone, message.sms, senders.twilio);
      if (!res.error) {
        texted = true;
        logRows.push({ from_number: senders.twilio.phoneNumber, to_number: lead.phone, body: message.sms, twilio_sid: res.sid || null, channel: "sms" });
      }
    }
    if (canEmail && senders.email) {
      const res = await sendEmail(recipients.to, message.subject, message.html, message.text, {
        replyTo: senders.email.replyTo ?? undefined,
        env: senders.email,
        cc: recipients.cc,
      });
      if (!res.error) {
        emailed = true;
        for (const addr of [...recipients.to, ...recipients.cc]) {
          logRows.push({ from_number: "email", to_number: addr, body: `[Reminder emailed] ${message.subject}`, twilio_sid: res.id || null, channel: "email" });
        }
      }
    }
    if (!texted && !emailed) {
      // Nothing went: the step is free for the next run.
      await release();
      continue;
    }
    await admin.from("bill_reminders").update({ sent_via: sentViaOf(texted, emailed) }).eq("id", claim.id);
    // In the contact's messages, where the team already looks.
    for (const log of logRows) {
      await admin.from("sms_messages").insert({ lead_id: lead.id, direction: "outbound", company_id: companyId, ...log });
    }
    sent += 1;
  }
  return { checked: rows.length, sent };
}
