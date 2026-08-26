import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import { socialHref, type Event, type Profile, type SmsMessage } from "@/lib/data/types";
import { isExpired } from "@/lib/data/company-docs";
import { PortalHome, type PortalDoc, type PortalEstimate } from "./portal-home";

type EstimateRow = {
  id: string;
  doc_number: string;
  title: string | null;
  status: string;
  total_cents: number;
  deposit_cents: number | null;
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
    { data: reps },
    { data: estimateRows },
    { data: paymentRows },
    { data: docRows },
  ] = await Promise.all([
    admin
      .from("events")
      .select("*")
      .eq("lead_id", viewer.lead.id)
      .order("date", { ascending: true })
      .order("time", { ascending: true }),
    admin
      .from("lead_files")
      .select("id, file_name, file_url, content_type, created_at, uploaded_by")
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
    admin.from("profiles").select("id, name, email, phone"),
    // Draft is excluded deliberately: the estimate page itself redirects a
    // Draft back here, so listing one would be a link to nowhere -- and a
    // half-built estimate is not something to show a customer.
    admin
      .from("estimates")
      .select("id, doc_number, title, status, total_cents, deposit_cents")
      .eq("lead_id", viewer.lead.id)
      .in("status", ["Sent", "Viewed", "Signed", "Declined"])
      .order("created_at", { ascending: false })
      .returns<EstimateRow[]>(),
    admin
      .from("portal_payments")
      .select("estimate_id, kind, status")
      .eq("lead_id", viewer.lead.id)
      .returns<{ estimate_id: string; kind: string; status: string }[]>(),
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
  ]);

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
  const estimates: PortalEstimate[] = (estimateRows ?? []).map((e) => {
    const depositPaid = (paymentRows ?? []).some(
      (p) => p.estimate_id === e.id && p.kind === "deposit" && p.status === "succeeded"
    );
    const owed = e.status === "Signed" && !depositPaid ? e.deposit_cents || 0 : 0;
    return { ...e, depositPaid, amountDueCents: owed };
  });

  return (
    <PortalHome
      lead={viewer.lead}
      events={(events as Event[]) ?? []}
      files={(files as PortalFile[]) ?? []}
      messages={(messages as SmsMessage[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      estimates={estimates}
      companyName={companyRow?.name || "Your Contractor"}
      companyPhone={companyRow?.phone || null}
      companyLogo={companyRow?.logo_url || null}
      socialLinks={socialLinks}
      // Filtered here rather than in the query: a lapsed certificate shown
      // to a customer is worse than none, and "hide it once it expires"
      // has to hold without anyone remembering to untick a box.
      documents={(docRows ?? []).filter((d) => !isExpired(d.expires_on))}
    />
  );
}
