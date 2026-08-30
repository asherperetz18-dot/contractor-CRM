"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canViewEstimates,
  isAdminRole,
  isFieldRole,
  paidTotalCents,
  type PortalPayment,
} from "@/lib/data/types";

export type BellItem = {
  /** Stable across recomputes, so the client can key and dedupe. */
  id: string;
  kind: "message" | "money" | "job";
  icon: string;
  title: string;
  body: string;
  at: string;
  href: string;
};

export type BellData = {
  items: BellItem[];
  seenAt: string | null;
  summary: string;
};

const DAY = 86400000;

/**
 * The bell's feed, computed fresh from the tables that already hold the
 * facts. Nothing here writes events at the moment they happen -- a feed
 * derived on demand can never drift out of sync with the data it
 * describes, and every query below runs on the caller's own RLS
 * session, so each role's bell can only ever say what that role could
 * already open.
 */
export async function getNotifications(): Promise<{ error?: string; data?: BellData }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // The crew has no bell at all -- their whole app is the job list.
  if (isFieldRole(profile) && !canViewEstimates(profile)) {
    return { data: { items: [], seenAt: null, summary: "" } };
  }

  const supabase = await createClient();
  const companyId = profile.company_id;
  const now = Date.now();
  const since48h = new Date(now - 2 * DAY).toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);

  const staffsPhones =
    isAdminRole(profile) ||
    profile.roles.includes("Office") ||
    profile.roles.includes("Dispatch");
  const seesMoney = canViewEstimates(profile) && (isAdminRole(profile) || profile.roles.includes("Bookkeeping"));
  const seesEstimates = canViewEstimates(profile);

  const [reads, failedTexts, duePhases, paidRecent, viewsRecent, signedRecent, dueSteps] =
    await Promise.all([
      // Tolerant on purpose: before migration 0115 has run, this errors
      // and the bell simply treats everything as unseen.
      supabase
        .from("notification_reads")
        .select("seen_at")
        .eq("profile_id", profile.id)
        .eq("company_id", companyId)
        .maybeSingle(),
      staffsPhones
        ? supabase
            .from("sms_messages")
            .select("id, to_number, delivery_error, created_at, lead_id")
            .eq("company_id", companyId)
            .eq("direction", "outbound")
            .in("delivery_status", ["failed", "undelivered"])
            .gte("created_at", since7d)
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      seesMoney
        ? supabase
            .from("estimate_payments")
            .select("id, estimate_id, name, amount_cents, due_date, requested_at")
            .eq("company_id", companyId)
            .not("requested_at", "is", null)
            .lt("due_date", today)
            .order("due_date", { ascending: true })
            .limit(50)
        : Promise.resolve({ data: [] }),
      seesMoney
        ? supabase
            .from("portal_payments")
            .select("id, estimate_id, amount_cents, paid_at")
            .eq("company_id", companyId)
            .eq("status", "succeeded")
            .gte("paid_at", since48h)
            .order("paid_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      seesEstimates
        ? supabase
            .from("estimate_views")
            .select("id, estimate_id, viewed_at")
            .eq("company_id", companyId)
            .gte("viewed_at", since48h)
            .order("viewed_at", { ascending: false })
            .limit(15)
        : Promise.resolve({ data: [] }),
      seesEstimates
        ? supabase
            .from("estimates")
            .select("id, doc_number, title, signed_at")
            .eq("company_id", companyId)
            .gte("signed_at", since48h)
            .order("signed_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      supabase
        .from("project_checklist_items")
        .select("id, estimate_id, label, due_date, assigned_to")
        .eq("company_id", companyId)
        .is("completed_at", null)
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(50),
    ]);

  type Phase = { id: string; estimate_id: string; name: string | null; amount_cents: number; due_date: string; requested_at: string };
  type Sms = { id: string; to_number: string; delivery_error: string | null; created_at: string; lead_id: string | null };
  type View = { id: string; estimate_id: string; viewed_at: string };
  type Signed = { id: string; doc_number: string; title: string | null; signed_at: string };
  type Step = { id: string; estimate_id: string; label: string; due_date: string; assigned_to: string | null };
  type Paid = { id: string; estimate_id: string; amount_cents: number; paid_at: string };

  const phases = (duePhases.data ?? []) as Phase[];
  const paid = (paidRecent.data ?? []) as Paid[];
  const views = (viewsRecent.data ?? []) as View[];
  const signed = (signedRecent.data ?? []) as Signed[];

  // Names for every document the feed mentions, fetched once.
  const estimateIds = [
    ...new Set([
      ...phases.map((p) => p.estimate_id),
      ...paid.map((p) => p.estimate_id),
      ...views.map((v) => v.estimate_id),
    ]),
  ];
  const docById = new Map<string, string>();
  if (estimateIds.length) {
    const { data: docs } = await supabase
      .from("estimates")
      .select("id, doc_number, title")
      .in("id", estimateIds);
    for (const d of (docs ?? []) as { id: string; doc_number: string; title: string | null }[]) {
      docById.set(d.id, d.title ? `${d.doc_number} · ${d.title}` : d.doc_number);
    }
  }

  // What a phase still waits on: payments that actually settled.
  const paidByPhase = new Map<string, number>();
  if (phases.length) {
    const { data: allPaid } = await supabase
      .from("portal_payments")
      .select("estimate_payment_id, amount_cents, status")
      .eq("company_id", companyId)
      .in("estimate_id", [...new Set(phases.map((p) => p.estimate_id))]);
    for (const p of (allPaid ?? []) as Pick<PortalPayment, "estimate_payment_id" | "amount_cents" | "status">[]) {
      if (!p.estimate_payment_id) continue;
      paidByPhase.set(
        p.estimate_payment_id,
        (paidByPhase.get(p.estimate_payment_id) ?? 0) + paidTotalCents([p])
      );
    }
  }

  const money = (cents: number) =>
    "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const daysAgo = (iso: string) => Math.max(1, Math.floor((now - new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).getTime()) / DAY));

  const items: BellItem[] = [];

  for (const t of ((failedTexts.data ?? []) as Sms[])) {
    items.push({
      id: `sms:${t.id}`,
      kind: "message",
      icon: "💬",
      title: "Text didn't deliver",
      body: `To ${t.to_number}${t.delivery_error ? ` — error ${t.delivery_error}` : ""}`,
      at: t.created_at,
      href: "/reply-inbox",
    });
  }

  const overduePhases = phases.filter(
    (p) => p.amount_cents - (paidByPhase.get(p.id) ?? 0) > 0
  );
  for (const p of overduePhases.slice(0, 12)) {
    const owed = p.amount_cents - (paidByPhase.get(p.id) ?? 0);
    const days = daysAgo(p.due_date);
    items.push({
      id: `inv:${p.id}`,
      kind: "money",
      icon: "💲",
      title: days >= 30 ? "Invoice 30+ days overdue" : "Invoice overdue",
      body: `${docById.get(p.estimate_id) ?? "A job"}${p.name ? ` · ${p.name}` : ""}: ${money(owed)} outstanding, due ${days}d ago`,
      // The due date, not now: an invoice that has sat unpaid for a
      // month must not ring the bell as "new" every single day.
      at: p.due_date + "T12:00:00Z",
      href: `/estimates/${p.estimate_id}`,
    });
  }

  for (const p of paid) {
    items.push({
      id: `paid:${p.id}`,
      kind: "money",
      icon: "✅",
      title: "Payment received",
      body: `${money(p.amount_cents)} on ${docById.get(p.estimate_id) ?? "a job"}`,
      at: p.paid_at ?? new Date(now).toISOString(),
      href: `/estimates/${p.estimate_id}`,
    });
  }

  for (const v of views) {
    items.push({
      id: `view:${v.id}`,
      kind: "job",
      icon: "👀",
      title: "Customer opened a proposal",
      body: docById.get(v.estimate_id) ?? "A document was viewed in the portal",
      at: v.viewed_at,
      href: `/estimates/${v.estimate_id}`,
    });
  }

  for (const s of signed) {
    items.push({
      id: `signed:${s.id}`,
      kind: "job",
      icon: "✍️",
      title: "Signed!",
      body: s.title ? `${s.doc_number} · ${s.title}` : s.doc_number,
      at: s.signed_at,
      href: `/estimates/${s.id}`,
    });
  }

  const steps = ((dueSteps.data ?? []) as Step[]).filter((s) =>
    isAdminRole(profile) ? true : s.assigned_to === profile.id
  );
  for (const s of steps.slice(0, 12)) {
    items.push({
      id: `step:${s.id}`,
      kind: "job",
      icon: "☑️",
      title: s.assigned_to === profile.id ? "Your step is overdue" : "Job step overdue",
      body: `${s.label} — due ${daysAgo(s.due_date)}d ago`,
      at: s.due_date + "T12:00:00Z",
      href: "/projects",
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1));

  const parts: string[] = [];
  if ((failedTexts.data ?? []).length) parts.push(`${(failedTexts.data ?? []).length} failed texts`);
  if (overduePhases.length) parts.push(`${overduePhases.length} overdue invoices`);
  if (steps.length) parts.push(`${steps.length} overdue steps`);
  if (views.length) parts.push(`${views.length} proposal views`);
  if (paid.length) parts.push(`${paid.length} payments in`);

  return {
    data: {
      items: items.slice(0, 40),
      seenAt: reads.error ? null : ((reads.data as { seen_at: string } | null)?.seen_at ?? null),
      summary: parts.join(" · "),
    },
  };
}

/** "Mark all read": stamp the watermark; the badge empties itself. */
export async function markNotificationsRead(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_reads")
    .upsert(
      { profile_id: profile.id, company_id: profile.company_id, seen_at: new Date().toISOString() },
      { onConflict: "profile_id,company_id" }
    );
  if (error) return { error: error.message };
  return {};
}
