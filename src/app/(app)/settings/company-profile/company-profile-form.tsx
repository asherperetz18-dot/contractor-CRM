"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { saveCompanyProfile, type CompanyProfileInput } from "@/lib/actions/settings";
import type { CompanyProfile, TimeFormat } from "@/lib/data/types";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const TIMEZONES = [
  { value: "Pacific", label: "Pacific Time (PT)" },
  { value: "Mountain", label: "Mountain Time (MT)" },
  { value: "Central", label: "Central Time (CT)" },
  { value: "Eastern", label: "Eastern Time (ET)" },
  { value: "Alaska", label: "Alaska Time (AKT)" },
  { value: "Hawaii", label: "Hawaii Time (HT)" },
];

const STATE_TZ: Record<string, string> = {
  CA: "Pacific", OR: "Pacific", WA: "Pacific", NV: "Pacific",
  AZ: "Mountain", CO: "Mountain", UT: "Mountain", NM: "Mountain", MT: "Mountain", WY: "Mountain", ID: "Mountain",
  TX: "Central", IL: "Central", MO: "Central", MN: "Central", WI: "Central", LA: "Central", OK: "Central", KS: "Central", NE: "Central", IA: "Central", AR: "Central", MS: "Central", AL: "Central", TN: "Central", SD: "Central", ND: "Central",
  NY: "Eastern", FL: "Eastern", GA: "Eastern", NC: "Eastern", SC: "Eastern", VA: "Eastern", PA: "Eastern", OH: "Eastern", MI: "Eastern", NJ: "Eastern", MA: "Eastern", MD: "Eastern", CT: "Eastern", ME: "Eastern", NH: "Eastern", VT: "Eastern", RI: "Eastern", DE: "Eastern", WV: "Eastern", KY: "Eastern", IN: "Eastern",
  AK: "Alaska", HI: "Hawaii",
};

function guessStateFromAddress(address: string) {
  if (!address) return null;
  const match = address.toUpperCase().match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/);
  return match ? STATE_TZ[match[1]] : null;
}

function toInput(p: CompanyProfile | null): CompanyProfileInput {
  return {
    name: p?.name ?? "",
    address: p?.address ?? "",
    email: p?.email ?? "",
    phone: p?.phone ?? "",
    website: p?.website ?? "",
    license_holder_name: p?.license_holder_name ?? "",
    license_number: p?.license_number ?? "",
    license_state: p?.license_state ?? "",
    license_type: p?.license_type ?? "",
    timezone: p?.timezone ?? "Pacific",
    time_format: p?.time_format ?? "12h",
  };
}

export function CompanyProfileForm({ profile }: { profile: CompanyProfile | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<CompanyProfileInput>(toInput(profile));
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof CompanyProfileInput>(k: K, v: CompanyProfileInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  function detectTimezone() {
    const guess = STATE_TZ[form.license_state] || guessStateFromAddress(form.address);
    if (guess) set("timezone", guess);
  }

  async function save() {
    setPending(true);
    setError("");
    const result = await saveCompanyProfile(form);
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
        <span>Company Profile</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Company Profile</h1>
          <p className="module-sub">
            Company name, address, phone, email, website, and license details
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">🏢 Company Profile</div>
        <p className="cp-card-sub">
          Company name, address, phone, email, website, license details, and
          timezone
        </p>

        <Field label="Company Address">
          <input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Street, city, state, zip"
          />
        </Field>
        <Field label="Company Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="info@yourcompany.com"
          />
        </Field>
        <p className="cp-hint">
          Company email address displayed on invoices and documents
        </p>
        <Field label="Company Name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Company Phone">
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Company Website">
          <input
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="yourcompany.com"
          />
        </Field>
        <Field label="License Holder Name">
          <input
            value={form.license_holder_name}
            onChange={(e) => set("license_holder_name", e.target.value)}
          />
        </Field>
        <Field label="License Number">
          <input
            value={form.license_number}
            onChange={(e) => set("license_number", e.target.value)}
          />
        </Field>
        <Field label="License State">
          <select
            value={form.license_state}
            onChange={(e) => set("license_state", e.target.value)}
          >
            <option value="">— select —</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <p className="cp-hint">
          State that issued the company GC license (2-letter code)
        </p>
        <Field label="License Type">
          <input
            value={form.license_type}
            onChange={(e) => set("license_type", e.target.value)}
            placeholder="General Contractor, B, C-10..."
          />
        </Field>
        <p className="cp-hint">Type of license held by the company</p>

        <div className="cp-divider" />
        <div className="cp-tz-head">
          <span>🌐 Timezone</span>
          <button className="btn-ghost small" onClick={detectTimezone}>
            ↻ Detect from address
          </button>
        </div>
        <Field label="">
          <select
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="cp-hint">
          Used for SMS reminder windows, task due-date bucketing, and
          financial date fallbacks. All times shown to your team are in this
          timezone.
        </p>

        <div className="cp-divider" />
        <div className="cp-tz-head">
          <span>🕐 Time Format</span>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={"segmented-btn" + (form.time_format === "12h" ? " active" : "")}
            onClick={() => set("time_format", "12h" as TimeFormat)}
          >
            Standard (1:00 PM)
          </button>
          <button
            type="button"
            className={"segmented-btn" + (form.time_format === "24h" ? " active" : "")}
            onClick={() => set("time_format", "24h" as TimeFormat)}
          >
            Military (13:00)
          </button>
        </div>
        <p className="cp-hint">
          Controls how appointment time pickers throughout the app show and let you enter times.
        </p>

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <div>{saved && <span className="cp-saved">✓ Saved</span>}</div>
          <div>
            <button className="btn-primary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save Company Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
