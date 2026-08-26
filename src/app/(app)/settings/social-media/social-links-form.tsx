"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { saveSocialLinks, type SocialLinksInput } from "@/lib/actions/settings";
import type { CompanyProfile } from "@/lib/data/types";

// Label, column, and a placeholder showing the accepted shapes -- a full
// URL, a bare domain path, or (where handles are the norm) an @handle.
const NETWORKS: {
  key: keyof SocialLinksInput;
  label: string;
  placeholder: string;
}[] = [
  { key: "facebook_url", label: "Facebook Page", placeholder: "facebook.com/yourcompany" },
  { key: "instagram_url", label: "Instagram", placeholder: "@yourcompany" },
  { key: "linkedin_url", label: "LinkedIn", placeholder: "linkedin.com/company/yourcompany" },
  { key: "youtube_url", label: "YouTube", placeholder: "youtube.com/@yourcompany" },
  { key: "tiktok_url", label: "TikTok", placeholder: "@yourcompany" },
  { key: "yelp_url", label: "Yelp", placeholder: "yelp.com/biz/yourcompany" },
  {
    key: "google_reviews_url",
    label: "Google Reviews",
    placeholder: "g.page/r/... (from your Google Business Profile)",
  },
];

function toInput(p: CompanyProfile | null): SocialLinksInput {
  return {
    facebook_url: p?.facebook_url ?? "",
    instagram_url: p?.instagram_url ?? "",
    linkedin_url: p?.linkedin_url ?? "",
    youtube_url: p?.youtube_url ?? "",
    tiktok_url: p?.tiktok_url ?? "",
    yelp_url: p?.yelp_url ?? "",
    google_reviews_url: p?.google_reviews_url ?? "",
  };
}

export function SocialLinksForm({ profile }: { profile: CompanyProfile | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<SocialLinksInput>(toInput(profile));
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof SocialLinksInput, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setPending(true);
    setError("");
    const result = await saveSocialLinks(form);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Social Media Links</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Social Media Links</h1>
          <p className="module-sub">
            Shown to your customers on the portal — only the profiles you fill in appear
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">🔗 Your Profiles</div>
        <p className="cp-card-sub">
          Paste the link or handle for each network you have. Blank means that
          network simply isn&apos;t shown anywhere.
        </p>

        {NETWORKS.map((n) => (
          <Field key={n.key} label={n.label}>
            <input
              value={form[n.key]}
              onChange={(e) => set(n.key, e.target.value)}
              placeholder={n.placeholder}
            />
          </Field>
        ))}

        <p className="hint-note">
          Facebook and Instagram are the same values as on the Company Profile
          page, and also feed the <code className="mono">{"{links}"}</code>{" "}
          variable in appointment texts.
        </p>

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <span className="hint-note">{saved ? "✓ Saved" : ""}</span>
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
