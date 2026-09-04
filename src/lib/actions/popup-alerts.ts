"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canEditDispatch,
  canViewEstimates,
  isAdminRole,
  isFieldRole,
} from "@/lib/data/types";
import { getTextAlerts, type FreshText } from "@/lib/actions/text-alerts";
import type { PopupToast } from "@/lib/popup-shape";

/** One popup's worth of something that just happened. */
export type PopupItem = PopupToast & {
  /** When it happened -- the watermark the client advances past. */
  at: string;
};

type TextsPart = { awaitingCount: number; latestIso: string | null; fresh: FreshText[] };

export type PopupAlerts = {
  /** The incoming-text watcher's answer, riding along in the same poll. */
  texts: TextsPart;
  /** Everything else that happened since `eventsSince`. */
  events: PopupItem[];
  /** The newest event timestamp seen, or `eventsSince` when nothing came. */
  latestIso: string | null;
};

/**
 * Two watermarks, not one: texts and events are stored under separate
 * keys in the browser, and a single "since" would be the OLDER of the
 * two -- replaying a week of events every time a text is a day old.
 */
export type PopupAlertsInput = {
  textsSince: string | null;
  eventsSince: string | null;
};

const EMPTY_TEXTS: TextsPart = { awaitingCount: 0, latestIso: null, fresh: [] };
// Per kind per poll. A burst turns into one summary toast on the
// client, not a wall -- but the server caps first so a bulk import of
// 600 leads never ships 600 rows to every open tab.
const PER_KIND = 10;

function personName(l: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
}): string {
  return [l.first_name, l.last_name].filter(Boolean).join(" ") || l.company_name || "";
}

const money = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What the popup watcher polls: the incoming texts it always polled, plus
 * the things that just happened that used to sit silently in the bell
 * until somebody clicked it -- a payment, a signature, a customer opening
 * a proposal, a text that failed, a new lead, an appointment booked for
 * you, a job step handed to you.
 *
 * Only EVENTS pop. Standing conditions (an invoice overdue, a step
 * overdue) stay bell-only on purpose: something that is true for a month
 * would pop up every morning of that month, and that teaches people to
 * close every popup unread.
 *
 * Every query runs on the caller's own RLS session and behind the same
 * role checks the bell uses, so a popup can never say something its
 * reader could not already open.
 */
export async function getPopupAlerts({ textsSince, eventsSince }: PopupAlertsInput): Promise<{
  error?: string;
  data?: PopupAlerts;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // The crew's whole app is the job list; the bell hides from them and
  // so do the popups.
  if (isFieldRole(profile) && !canViewEstimates(profile)) {
    return { data: { texts: EMPTY_TEXTS, events: [], latestIso: eventsSince } };
  }

  const staffsPhones =
    isAdminRole(profile) ||
    profile.roles.includes("Office") ||
    profile.roles.includes("Dispatch");
  const seesMoney =
    canViewEstimates(profile) && (isAdminRole(profile) || profile.roles.includes("Bookkeeping"));
  const seesEstimates = canViewEstimates(profile);
  const worksLeads = canEditDispatch(profile);

  // Texts keep their own role rule: the people who staff the phones,
  // not every role that can merely open the inbox. getTextAlerts checks
  // the page-visibility matrix on top of that.
  const textsPromise: Promise<TextsPart> = staffsPhones
    ? getTextAlerts(textsSince).then((r) =>
        r.error
          ? EMPTY_TEXTS
          : { awaitingCount: r.awaitingCount ?? 0, latestIso: r.latestIso ?? null, fresh: r.fresh ?? [] }
      )
    : Promise.resolve(EMPTY_TEXTS);

  // A browser that has never polled has no event watermark: it seeds
  // itself at "now" and gets the texts' answer (badge count) with no
  // replay of last month's events.
  if (!eventsSince) {
    const texts = await textsPromise;
    return { data: { texts, events: [], latestIso: null } };
  }

  const supabase = await createClient();
  const companyId = profile.company_id;
  const me = profile.id;
  const since = eventsSince;

  const [texts, failedTexts, paid, signed, viewed, newLeads, newAppts, newSteps] =
    await Promise.all([
      textsPromise,
      staffsPhones
        ? supabase
            .from("sms_messages")
            .select("id, to_number, delivery_error, created_at, lead_id")
            .eq("company_id", companyId)
            .eq("direction", "outbound")
            .in("delivery_status", ["failed", "undelivered"])
            .gt("created_at", since)
            .order("created_at", { ascending: false })
            .limit(PER_KIND)
        : Promise.resolve({ data: [] }),
      seesMoney
        ? supabase
            .from("portal_payments")
            .select("id, estimate_id, amount_cents, paid_at")
            .eq("company_id", companyId)
            .eq("status", "succeeded")
            .gt("paid_at", since)
            .order("paid_at", { ascending: false })
            .limit(PER_KIND)
        : Promise.resolve({ data: [] }),
      seesEstimates
        ? supabase
            .from("estimates")
            .select("id, doc_number, title, signed_at")
            .eq("company_id", companyId)
            .gt("signed_at", since)
            .order("signed_at", { ascending: false })
            .limit(PER_KIND)
        : Promise.resolve({ data: [] }),
      seesEstimates
        ? supabase
            .from("estimate_views")
            .select("id, estimate_id, viewed_at")
            .eq("company_id", companyId)
            .gt("viewed_at", since)
            .order("viewed_at", { ascending: false })
            .limit(PER_KIND)
        : Promise.resolve({ data: [] }),
      // RLS already narrows a Sales rep to their own leads, so "every new
      // lead" means "every new lead you are allowed to see".
      worksLeads
        ? supabase
            .from("leads")
            .select("id, first_name, last_name, company_name, project_type, source, created_at, created_by")
            .eq("company_id", companyId)
            .gt("created_at", since)
            .order("created_at", { ascending: false })
            .limit(PER_KIND)
        : Promise.resolve({ data: [] }),
      // Booked FOR you by somebody else. Your own bookings you already know.
      supabase
        .from("events")
        .select("id, title, date, time, event_type, lead_id, assigned_to, second_assigned_to, created_by, created_at")
        .eq("company_id", companyId)
        .or(`assigned_to.eq.${me},second_assigned_to.eq.${me}`)
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(PER_KIND),
      supabase
        .from("project_checklist_items")
        .select("id, estimate_id, label, due_date, assigned_to, created_at")
        .eq("company_id", companyId)
        .eq("assigned_to", me)
        .is("completed_at", null)
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(PER_KIND),
    ]);

  type Sms = { id: string; to_number: string; delivery_error: string | null; created_at: string; lead_id: string | null };
  type Paid = { id: string; estimate_id: string; amount_cents: number; paid_at: string };
  type Signed = { id: string; doc_number: string; title: string | null; signed_at: string };
  type View = { id: string; estimate_id: string; viewed_at: string };
  type Lead = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    project_type: string | null;
    source: string | null;
    created_at: string;
    created_by: string | null;
  };
  type Appt = {
    id: string;
    title: string | null;
    date: string;
    time: string | null;
    event_type: string;
    lead_id: string | null;
    assigned_to: string | null;
    second_assigned_to: string | null;
    created_by: string | null;
    created_at: string;
  };
  type Step = { id: string; estimate_id: string; label: string; due_date: string | null; assigned_to: string | null; created_at: string };

  const failed = (failedTexts.data ?? []) as Sms[];
  const payments = (paid.data ?? []) as Paid[];
  const signatures = (signed.data ?? []) as Signed[];
  const views = (viewed.data ?? []) as View[];
  // A lead you entered yourself is not news to you.
  const leads = ((newLeads.data ?? []) as Lead[]).filter((l) => l.created_by !== me);
  const appts = ((newAppts.data ?? []) as Appt[]).filter((a) => a.created_by !== me);
  const steps = (newSteps.data ?? []) as Step[];

  // Names for the documents and people the popups mention, fetched once.
  const estimateIds = [
    ...new Set([
      ...payments.map((p) => p.estimate_id),
      ...views.map((v) => v.estimate_id),
      ...steps.map((s) => s.estimate_id),
    ]),
  ];
  const leadIds = [...new Set(appts.map((a) => a.lead_id).filter(Boolean))] as string[];

  const [docsRes, leadNamesRes] = await Promise.all([
    estimateIds.length
      ? supabase.from("estimates").select("id, doc_number, title").in("id", estimateIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? supabase.from("leads").select("id, first_name, last_name, company_name").in("id", leadIds)
      : Promise.resolve({ data: [] }),
  ]);
  const docById = new Map<string, string>();
  for (const d of (docsRes.data ?? []) as { id: string; doc_number: string; title: string | null }[]) {
    docById.set(d.id, d.title ? `${d.doc_number} · ${d.title}` : d.doc_number);
  }
  const leadNameById = new Map<string, string>();
  for (const l of (leadNamesRes.data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
  }[]) {
    leadNameById.set(l.id, personName(l));
  }

  const events: PopupItem[] = [];

  for (const t of failed) {
    events.push({
      id: `sms-failed:${t.id}`,
      kind: "message",
      icon: "⚠️",
      title: "Text didn't deliver",
      body: `To ${t.to_number}${t.delivery_error ? ` — error ${t.delivery_error}` : ""}`,
      at: t.created_at,
      href: "/reply-inbox",
      sticky: false,
    });
  }

  for (const p of payments) {
    events.push({
      id: `paid:${p.id}`,
      kind: "money",
      icon: "💲",
      title: `Payment received — ${money(p.amount_cents)}`,
      body: docById.get(p.estimate_id) ?? "A customer paid in the portal",
      at: p.paid_at,
      href: `/estimates/${p.estimate_id}`,
      sticky: true,
    });
  }

  for (const s of signatures) {
    events.push({
      id: `signed:${s.id}`,
      kind: "job",
      icon: "✍️",
      title: "Customer signed!",
      body: s.title ? `${s.doc_number} · ${s.title}` : s.doc_number,
      at: s.signed_at,
      href: `/estimates/${s.id}`,
      sticky: true,
    });
  }

  for (const v of views) {
    events.push({
      id: `view:${v.id}`,
      kind: "job",
      icon: "👀",
      title: "Customer opened a proposal",
      body: docById.get(v.estimate_id) ?? "A document was viewed in the portal",
      at: v.viewed_at,
      href: `/estimates/${v.estimate_id}`,
      sticky: false,
    });
  }

  for (const l of leads) {
    const detail = [l.project_type, l.source ? `via ${l.source}` : null].filter(Boolean).join(" · ");
    events.push({
      id: `lead:${l.id}`,
      kind: "lead",
      icon: "🆕",
      title: `New lead: ${personName(l) || "Unnamed contact"}`,
      body: detail || "Just came in",
      at: l.created_at,
      href: `/contacts?openLead=${encodeURIComponent(l.id)}`,
      sticky: false,
    });
  }

  for (const a of appts) {
    const who = a.lead_id ? leadNameById.get(a.lead_id) : null;
    const when = `${a.date}${a.time ? ` at ${a.time.slice(0, 5)}` : ""}`;
    events.push({
      id: `appt:${a.id}`,
      kind: "appointment",
      icon: "📅",
      title: "Appointment booked for you",
      body: `${a.title || who || a.event_type} — ${when}`,
      at: a.created_at,
      href: `/calendar?openEvent=${encodeURIComponent(a.id)}`,
      sticky: false,
    });
  }

  for (const s of steps) {
    events.push({
      id: `step:${s.id}`,
      kind: "job",
      icon: "☑️",
      title: "Job step assigned to you",
      body: `${s.label}${docById.has(s.estimate_id) ? ` · ${docById.get(s.estimate_id)}` : ""}${s.due_date ? ` — due ${s.due_date}` : ""}`,
      at: s.created_at,
      href: "/projects",
      sticky: false,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1));

  // Texts have their own watermark inside `texts`; this one covers the
  // events. Never older than what the caller already had.
  let latestIso = since;
  for (const e of events) if (e.at > latestIso) latestIso = e.at;

  return { data: { texts, events, latestIso } };
}
