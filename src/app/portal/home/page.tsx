import { nowInZone } from "@/lib/timezone";
import { zoneForCompany } from "@/lib/data/company-today";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import {
  paidTotalCents,
  socialHref,
  type Event,
  type PortalPayment,
  type SmsMessage,
} from "@/lib/data/types";
import { isExpired } from "@/lib/data/company-docs";
import { billedPhaseDueCents } from "@/lib/portal/portal-display";
import { portalStaffIds, toPortalStaff } from "@/lib/portal/portal-staff";
import type { SharedNote } from "@/lib/data/shared-notes";
import { PortalHome, type PortalDoc, type PortalEstimate, type PortalInvoice } from "./portal-home";

type EstimateRow = {
  id: string;
  doc_number: string;
  title: string | null;
  status: string;
  total_cents: number;
  deposit_cents: number | null;
  kind: string | null;
};

export const metadata = {
  title: "Your Project",
};

type PortalFile = {
  id: string;
  file_name: string;
  file_url: string | null;
  content_type: string | null;
  created_at: string;
  uploaded_by: string | null;
  /** Drive file id when storage_provider is google_drive; see leadPhotoThumbUrl. */
  file_path: string | null;
  storage_provider: string | null;
};

export default async function PortalHomePage() {
  const viewer = await getPortalViewer();
  if (!viewer) redirect("/portal");

  const admin = createAdminClient();
  const [
    { data: events },
    { data: files },
    { data: messages },
    { data: company },
    { data: estimateRows },
    { data: paymentRows },
    { data: docRows },
    { data: sharedNoteRows, error: sharedNotesError },
  ] = await Promise.all([
    admin
      .from("events")
      .select("*")
      .eq("lead_id", viewer.lead.id)
      .order("date", { ascending: true })
      .order("time", { ascending: true }),
    admin
      .from("lead_files")
      .select(
        "id, file_name, file_url, content_type, created_at, uploaded_by, file_path, storage_provider"
      )
      .eq("lead_id", viewer.lead.id)
      .order("created_at", { ascending: false }),
    admin
      .from("sms_messages")
      .select("*")
      .eq("lead_id", viewer.lead.id)
      .order("created_at", { ascending: true }),
    admin
      .from("company_profile")
      .select(
        "name, phone, logo_url, facebook_url, instagram_url, linkedin_url, youtube_url, tiktok_url, yelp_url, google_reviews_url"
      )
      .eq("company_id", viewer.companyId)
      .maybeSingle(),
    // Draft is excluded deliberately: the estimate page itself redirects a
    // Draft back here, so listing one would be a link to nowhere -- and a
    // half-built estimate is not something to show a customer.
    admin
      .from("estimates")
      .select("id, doc_number, title, status, total_cents, deposit_cents, kind")
      .eq("lead_id", viewer.lead.id)
      .in("status", ["Sent", "Viewed", "Signed", "Declined"])
      .order("created_at", { ascending: false })
      .returns<EstimateRow[]>(),
    admin
      .from("portal_payments")
      .select("estimate_id, estimate_payment_id, kind, status, amount_cents, stripe_session_id, stripe_payment_intent_id")
      .eq("lead_id", viewer.lead.id)
      .returns<
        {
          estimate_id: string;
          estimate_payment_id: string | null;
          kind: string;
          status: PortalPayment["status"];
          amount_cents: number;
          stripe_session_id: string | null;
          stripe_payment_intent_id: string | null;
        }[]
      >(),
    // Licence and insurance. Read with the service role because a
    // customer has no Supabase session -- the portal token already
    // established who they are and which company they belong to.
    admin
      .from("company_documents")
      .select("id, kind, title, file_url, expires_on")
      .eq("company_id", viewer.companyId)
      .eq("show_on_portal", true)
      .order("kind", { ascending: true })
      .returns<PortalDoc[]>(),
    // The notes shared between the customer and the team. Its own table
    // holds nothing internal, so reading all of this lead's rows is safe.
    admin
      .from("lead_shared_notes")
      .select(
        "id, lead_id, author_kind, author_id, body, kind, pinned, answer, answered_by, answered_at, edited_at, staff_seen_at, created_at"
      )
      .eq("lead_id", viewer.lead.id)
      .eq("company_id", viewer.companyId)
      .order("created_at", { ascending: false })
      .returns<SharedNote[]>(),
  ]);

  // Staff by the ids this customer's own rows name, name only -- never
  // the platform's roster, never an email or phone (see portal-staff.ts).
  const staffIds = portalStaffIds(
    (events as Event[]) ?? [],
    sharedNotesError ? null : (sharedNoteRows ?? [])
  );
  const { data: staffRows } = staffIds.length
    ? await admin
        .from("profiles")
        .select("id, name")
        .in("id", staffIds)
        .returns<{ id: string; name: string | null }[]>()
    : { data: [] };

  const companyRow = company as {
    name: string | null;
    phone: string | null;
    logo_url: string | null;
    facebook_url: string | null;
    instagram_url: string | null;
    linkedin_url: string | null;
    youtube_url: string | null;
    tiktok_url: string | null;
    yelp_url: string | null;
    google_reviews_url: string | null;
  } | null;

  // Resolved to real hrefs server-side (handles like "@lahome" expand to
  // their network's domain), so the client component only ever renders
  // ready-made links. Blank profiles never make it into the list.
  const socialLinks = [
    { label: "Facebook", href: socialHref(companyRow?.facebook_url ?? null, "facebook.com/") },
    { label: "Instagram", href: socialHref(companyRow?.instagram_url ?? null, "instagram.com/") },
    { label: "LinkedIn", href: socialHref(companyRow?.linkedin_url ?? null, "linkedin.com/company/") },
    { label: "YouTube", href: socialHref(companyRow?.youtube_url ?? null, "youtube.com/@") },
    { label: "TikTok", href: socialHref(companyRow?.tiktok_url ?? null, "tiktok.com/@") },
    { label: "Yelp", href: socialHref(companyRow?.yelp_url ?? null) },
    { label: "Google Reviews", href: socialHref(companyRow?.google_reviews_url ?? null) },
  ].filter((l) => l.href);

  // A deposit is only owed on a signed contract, and only until it lands.
  // Invoices (a permit fee billed back) get their own card: nothing to
  // sign, just something to pay -- and they are not a step in the job.
  const invoices: PortalInvoice[] = (estimateRows ?? [])
    .filter((e) => e.kind === "invoice" && e.status === "Signed")
    .map((e) => ({
      id: e.id,
      doc_number: e.doc_number,
      title: e.title,
      totalCents: e.total_cents,
      paidCents: paidTotalCents((paymentRows ?? []).filter((p) => p.estimate_id === e.id)),
    }));
  // Billed progress phases are owed too. Without them a job with the
  // deposit paid and completion billed read "✓ Deposit paid" here, and
  // the customer had no sign anything was due.
  const signedIds = (estimateRows ?? [])
    .filter((e) => e.kind !== "invoice" && e.status === "Signed")
    .map((e) => e.id);
  const { data: phaseRows } = signedIds.length
    ? await admin
        .from("estimate_payments")
        .select("id, estimate_id, amount_cents, requested_at, due_date")
        .in("estimate_id", signedIds)
        .not("requested_at", "is", null)
        .returns<
          { id: string; estimate_id: string; amount_cents: number; requested_at: string | null; due_date: string | null }[]
        >()
    : { data: [] };
  const estimates: PortalEstimate[] = (estimateRows ?? []).filter((e) => e.kind !== "invoice").map((e) => {
    const depositPaid = (paymentRows ?? []).some(
      (p) => p.estimate_id === e.id && p.kind === "deposit" && p.status === "succeeded"
    );
    const owed = e.status === "Signed" && !depositPaid ? e.deposit_cents || 0 : 0;
    const phaseDueCents =
      e.status === "Signed"
        ? billedPhaseDueCents(
            (phaseRows ?? []).filter((p) => p.estimate_id === e.id),
            (paymentRows ?? []).filter((p) => p.estimate_id === e.id)
          )
        : 0;
    return { ...e, depositPaid, amountDueCents: owed, phaseDueCents };
  });

  // Certificates lapse on the company's calendar, not the server's UTC
  // one -- "valid through Dec 31" holds all of Dec 31 in the office.
  const companyClock = nowInZone(await zoneForCompany(admin, viewer.companyId));

  return (
    <PortalHome
      lead={viewer.lead}
      events={(events as Event[]) ?? []}
      files={(files as PortalFile[]) ?? []}
      messages={(messages as SmsMessage[]) ?? []}
      reps={toPortalStaff(staffRows ?? [])}
      estimates={estimates}
      invoices={invoices}
      companyName={companyRow?.name || "Your Contractor"}
      companyPhone={companyRow?.phone || null}
      companyLogo={companyRow?.logo_url || null}
      socialLinks={socialLinks}
      // Filtered here rather than in the query: a lapsed certificate shown
      // to a customer is worse than none, and "hide it once it expires"
      // has to hold without anyone remembering to untick a box.
      documents={(docRows ?? []).filter((d) => !isExpired(d.expires_on, companyClock))}
      // null until migration 0183 has run: the Notes tab stays hidden
      // rather than offering a box that can't save.
      sharedNotes={sharedNotesError ? null : (sharedNoteRows ?? [])}
    />
  );
}
