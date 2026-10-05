"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { switchCompany } from "@/lib/actions/company";
import { exportCompanyData } from "@/lib/actions/backup";
import { extendTrial } from "@/lib/actions/trial-admin";
import { TRIAL_EXTENSIONS } from "@/lib/billing/trial";
import { formatUsageWithLimits, type CompanyLimits } from "@/lib/usage/limits";
import { setCompanyLimits } from "@/lib/actions/limits-admin";
import { openInCompany } from "@/lib/open-in-company";
import {
  BILLING_STATE_LABEL,
  directoryCounts,
  filterCompanyDirectory,
  type BillingState,
  type CompanyDirectoryRow,
  type DirectoryFilter,
} from "@/lib/company-directory";

const BILLING_CHIP: Record<BillingState, string> = {
  paying: "chip-c-done",
  trial: "chip-c-prog",
  payment_failed: "chip-c-hold",
  locked: "chip-c-dead",
  unsynced: "chip-c-hold",
  not_billed: "",
};

const FILTERS: { key: DirectoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...(Object.keys(BILLING_STATE_LABEL) as BillingState[]).map((key) => ({
    key,
    label: BILLING_STATE_LABEL[key],
  })),
];

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTrialEnd(iso: string, zone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" });
}

/**
 * More free-trial time for one company (DECISIONS #130): Stripe moves the
 * trial's end, and the page reloads with the new date.
 */
function ExtendTrial({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [days, setDays] = useState<number>(TRIAL_EXTENSIONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extend() {
    setBusy(true);
    setError(null);
    const res = await extendTrial(companyId, days);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="company-trial-extend">
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        disabled={busy}
        aria-label="Days to add to the free trial"
      >
        {TRIAL_EXTENSIONS.map((d) => (
          <option key={d} value={d}>
            +{d} days
          </option>
        ))}
      </select>
      <button type="button" className="btn-ghost small" onClick={extend} disabled={busy}>
        {busy ? "Extending…" : "Extend trial"}
      </button>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

/**
 * A company's monthly limits (DECISIONS #133): AI answers, texts, emails.
 * Blank is no limit, which is where every company starts.
 */
function LimitsEditor({ companyId, limits }: { companyId: string; limits: CompanyLimits }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ai, setAi] = useState(limits.ai?.toString() ?? "");
  const [sms, setSms] = useState(limits.sms?.toString() ?? "");
  const [email, setEmail] = useState(limits.email?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn-ghost small company-limits-open" onClick={() => setOpen(true)}>
        Set limits
      </button>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setCompanyLimits(companyId, { ai, sms, email });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="company-limits-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="No limit"
        disabled={busy}
      />
    </label>
  );

  return (
    <div className="company-limits-editor">
      <p className="hint-note">Each month. Leave blank for no limit.</p>
      {field("AI answers", ai, setAi)}
      {field("Texts", sms, setSms)}
      {field("Emails", email, setEmail)}
      <div className="company-limits-actions">
        <button type="button" className="btn-primary small" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save limits"}
        </button>
        <button type="button" className="btn-ghost small" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

/**
 * How much of its setup checklist a company has done (DECISIONS #136):
 * the count, with what's missing on hover -- written out on a phone.
 */
function SetupLine({ setup }: { setup: CompanyDirectoryRow["setup"] }) {
  if (!setup) return null;
  if (setup.missing.length === 0) return <div className="company-setup done">Setup done</div>;
  const missing = setup.missing.join(", ");
  return (
    <div className="company-setup">
      <span className="company-setup-count" title={`Missing: ${missing}`}>
        Setup {setup.done} of {setup.total}
      </span>
      <span className="company-setup-missing"> · missing {missing}</span>
    </div>
  );
}

/**
 * Downloads one company's data as a file (DECISIONS #134): the same file
 * its own Admin gets from Settings › Backup, without saved keys.
 */
function ExportCompany({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await exportCompanyData(companyId);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      const blob = new Blob([res.json ?? ""], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (res.companyName ?? "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.href = url;
      a.download = `crm-export-${slug || "company"}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote({ ok: true, text: `Downloaded ${res.rows?.toLocaleString() ?? 0} rows.` });
    } catch {
      setNote({ ok: false, text: "Something went wrong building the export." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost small company-export" onClick={run} disabled={busy}>
        {busy ? "Exporting…" : "Export"}
      </button>
      {note && <p className={note.ok ? "hint-note" : "error-note"}>{note.text}</p>}
    </>
  );
}

export function CompaniesView({ companies, zone }: { companies: CompanyDirectoryRow[]; zone: string }) {
  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const rows = useMemo(() => filterCompanyDirectory(companies, filter, search), [companies, filter, search]);
  const counts = useMemo(() => directoryCounts(companies), [companies]);

  async function open(companyId: string) {
    setBusyId(companyId);
    setRowError(null);
    const result = await switchCompany(companyId);
    setBusyId(null);
    if (result?.error) {
      setRowError({ id: companyId, message: result.error });
      return;
    }
    openInCompany();
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Companies</h1>
          <p className="module-sub">
            Every company on AI Build Pro · <Link href="/platform-admin">Platform Admin</Link>
          </p>
        </div>
      </div>

      <div className="cp-card invite-history-card">
        <div className="cp-card-head">🏢 All companies</div>
        <p className="cp-card-sub">
          Who owns each company, how many people work in it, where its AI Build Pro billing
          stands, and what it has used this month (AI, texts, emails). Not billed means it has never had a subscription (you made it, or it came before
          self-serve signup) and is never locked. Team counts the company&apos;s own active people,
          not platform admins. Under each name, how many of the six setup steps it has done
          (business details, logo, phone number, online payments, contract, team); hover to see
          what&apos;s missing.
        </p>

        <div className="invite-history-tools">
          <div className="chip-row invite-history-tabs">
            {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
              <button
                key={f.key}
                type="button"
                className={`chip${filter === f.key ? " chip-sel" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="invite-tab-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            className="invite-history-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or owner"
            aria-label="Search companies"
          />
        </div>

        {companies.length === 0 ? (
          <p className="hint-note">No companies yet.</p>
        ) : rows.length === 0 ? (
          <p className="hint-note">Nothing matches.</p>
        ) : (
          <div className="ur-table-scroll">
            <table className="data-table ur-table invite-history-table company-directory-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Owner</th>
                  <th>Team</th>
                  <th>Started</th>
                  <th>Billing</th>
                  <th>This month</th>
                  <th className="right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="company-directory-name">
                        {r.name}
                        <SetupLine setup={r.setup} />
                      </td>
                      <td data-label="Owner">
                        {r.owner ? (
                          <>
                            {r.owner.name || "—"}
                            {r.owner.email && <div className="hint-note invite-email">{r.owner.email}</div>}
                          </>
                        ) : (
                          <span className="hint-note">Nobody yet</span>
                        )}
                      </td>
                      <td data-label="Team">{r.team}</td>
                      <td data-label="Started" title={r.createdAt}>
                        {fmtDay(r.createdAt)}
                      </td>
                      <td data-label="Billing">
                        <span className={`chip invite-status ${BILLING_CHIP[r.billing]}`}>
                          {BILLING_STATE_LABEL[r.billing]}
                        </span>
                        {r.billing === "trial" && (
                          <>
                            {r.trialEndsAt && (
                              <span className="hint-note"> until {fmtTrialEnd(r.trialEndsAt, zone)}</span>
                            )}
                            <ExtendTrial companyId={r.id} />
                          </>
                        )}
                      </td>
                      <td data-label="This month" className="company-usage-cell">
                        {formatUsageWithLimits(r.usage, r.limits)}
                        <LimitsEditor companyId={r.id} limits={r.limits} />
                      </td>
                      <td className="right">
                        <button type="button" className="btn-ghost small" onClick={() => open(r.id)} disabled={busy}>
                          {busy ? "Opening…" : "Open"}
                        </button>
                        <ExportCompany companyId={r.id} />
                        {rowError?.id === r.id && <p className="error-note">{rowError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
