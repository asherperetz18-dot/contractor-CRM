"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { switchCompany } from "@/lib/actions/company";
import { extendTrial } from "@/lib/actions/trial-admin";
import { TRIAL_EXTENSIONS } from "@/lib/billing/trial";
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
          Who owns each company, how many people work in it, and where its AI Build Pro billing
          stands. Not billed means it has never had a subscription (you made it, or it came before
          self-serve signup) and is never locked. Team counts the company&apos;s own active people,
          not platform admins.
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
                  <th className="right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="company-directory-name">{r.name}</td>
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
                      <td className="right">
                        <button type="button" className="btn-ghost small" onClick={() => open(r.id)} disabled={busy}>
                          {busy ? "Opening…" : "Open"}
                        </button>
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
