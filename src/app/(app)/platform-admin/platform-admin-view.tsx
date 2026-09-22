"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { resendSignupInvite, sendManualSignupInvite } from "@/lib/actions/admin-invite";
import { switchCompany } from "@/lib/actions/company";
import { grantPlatformAdmin, revokePlatformAdmin } from "@/lib/actions/platform-admin";
import type { PlatformAdminRow } from "@/lib/data/platform-admin";
import {
  canResendInvite,
  filterInviteHistory,
  INVITE_STATUS_LABEL,
  inviteStatus,
  type InviteHistoryRow,
  type InviteStatus,
  type InviteTab,
} from "@/lib/signup/invite-history";

function InviteBusinessCard() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function send() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setPending(true);
    setError("");
    const result = await sendManualSignupInvite(trimmed);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSentTo(trimmed);
    setEmail("");
    router.refresh();
  }

  return (
    <div className="cp-card">
      <div className="cp-card-head">✉️ Invite a Business</div>
      <p className="cp-card-sub">
        Send a setup link straight to an email address — no payment involved.
        They pick their own company name, password, and starter lists when they
        open it. The link works once and expires in 7 days, same as a paid
        signup&apos;s.
      </p>

      <Field label="Email address">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSentTo(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="owner@theirbusiness.com"
          disabled={pending}
        />
      </Field>

      {error && <p className="error-note">{error}</p>}
      {sentTo && (
        <p className="hint-note" style={{ color: "var(--success)" }}>
          ✓ Sent to {sentTo}
        </p>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={send}
          disabled={pending || !email.trim()}
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

// One color per idea, never decoration: green = an account exists,
// blue = a live link somebody may still open, amber = nudge needed (the
// link lapsed), red = broken (the email never went out).
const STATUS_CHIP: Record<InviteStatus, string> = {
  set_up: "chip-c-done",
  pending: "chip-c-prog",
  expired: "chip-c-hold",
  send_failed: "chip-c-dead",
};

const TABS: { key: InviteTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "set_up", label: "Set up" },
  { key: "expired", label: "Expired" },
  { key: "send_failed", label: "Send failed" },
];

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function InviteHistoryCard({ invites, now }: { invites: InviteHistoryRow[]; now: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<InviteTab>("all");
  const [search, setSearch] = useState("");
  // Which row's button is mid-flight, so only that one disables.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);

  // `now` comes from the server render (react-hooks/purity forbids a
  // Date.now() in render). Days of granularity, so a long-open tab
  // being a few minutes stale changes nothing.
  const rows = useMemo(() => filterInviteHistory(invites, tab, search, now), [invites, tab, search, now]);
  const counts = useMemo(() => {
    const c: Record<InviteTab, number> = { all: invites.length, pending: 0, set_up: 0, expired: 0, send_failed: 0 };
    for (const r of invites) c[inviteStatus(r, now)] += 1;
    return c;
  }, [invites, now]);

  async function resend(id: string) {
    setBusyId(id);
    setRowError(null);
    setResentId(null);
    const result = await resendSignupInvite(id);
    setBusyId(null);
    if (result?.error) {
      setRowError({ id, message: result.error });
      router.refresh();
      return;
    }
    setResentId(id);
    router.refresh();
  }

  async function openCompany(id: string, companyId: string) {
    setBusyId(id);
    setRowError(null);
    const result = await switchCompany(companyId);
    setBusyId(null);
    if (result?.error) {
      setRowError({ id, message: result.error });
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="cp-card invite-history-card">
      <div className="cp-card-head">🕘 Invite History</div>
      <p className="cp-card-sub">
        Every setup link ever sent, paid or by hand, newest first. Pending
        means the link is live and nobody has opened it yet; Expired means
        the 7 days ran out. Resend puts a fresh link in the same inbox and
        the old one stops working.
      </p>

      <div className="invite-history-tools">
        <div className="chip-row invite-history-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip${tab === t.key ? " chip-sel" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label} <span className="invite-tab-count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="invite-history-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email or company"
          aria-label="Search invites"
        />
      </div>

      {invites.length === 0 ? (
        <p className="hint-note">No invites sent yet.</p>
      ) : rows.length === 0 ? (
        <p className="hint-note">Nothing matches.</p>
      ) : (
        <div className="ur-table-scroll">
          <table className="data-table ur-table invite-history-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Company</th>
                <th>Sent by</th>
                <th>Sent on</th>
                <th>Status</th>
                <th className="right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = inviteStatus(r, now);
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="invite-email">{r.email}</td>
                    <td>{r.company_name || <span className="hint-note">—</span>}</td>
                    <td>{r.source === "stripe" ? "Signup page (paid)" : r.sent_by_name || "—"}</td>
                    <td title={r.invite_sent_at ?? r.created_at}>{fmtDay(r.invite_sent_at ?? r.created_at)}</td>
                    <td>
                      <span className={`chip invite-status ${STATUS_CHIP[status]}`}>
                        {INVITE_STATUS_LABEL[status]}
                      </span>
                      {status === "pending" && (
                        <span className="hint-note invite-expiry"> until {fmtDay(r.expires_at)}</span>
                      )}
                    </td>
                    <td className="right">
                      {status === "set_up" && r.company_id ? (
                        <button
                          type="button"
                          className="btn-ghost small"
                          onClick={() => openCompany(r.id, r.company_id as string)}
                          disabled={busy}
                        >
                          {busy ? "Opening…" : "Open company"}
                        </button>
                      ) : canResendInvite(r, now) ? (
                        <button
                          type="button"
                          className="btn-ghost small"
                          onClick={() => resend(r.id)}
                          disabled={busy}
                        >
                          {busy ? "Sending…" : resentId === r.id ? "✓ Resent" : "Resend"}
                        </button>
                      ) : null}
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
  );
}

function PlatformAdminsCard({ admins, selfId }: { admins: PlatformAdminRow[]; selfId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [grantPending, setGrantPending] = useState(false);
  const [grantError, setGrantError] = useState("");
  // Which row's Revoke button is mid-flight, so only that one disables --
  // revoking one person should not freeze the whole list.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");

  async function grant() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setGrantPending(true);
    setGrantError("");
    const result = await grantPlatformAdmin(trimmed);
    setGrantPending(false);
    if (result?.error) {
      setGrantError(result.error);
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setRevokeError("");
    const result = await revokePlatformAdmin(id);
    setRevokingId(null);
    if (result?.error) {
      setRevokeError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="cp-card">
      <div className="cp-card-head">🛡️ Platform Admins</div>
      <p className="cp-card-sub">
        Holding this makes someone a real Office + Admin member of{" "}
        <strong>every company on the platform</strong>, present and future —
        not just the ones they&apos;d otherwise belong to. It&apos;s also what lets
        them invite a business above, and grant or revoke this same access on
        someone else. Revoking it removes that access again, except from any
        company they were already a genuine member of on their own.
      </p>

      {admins.length === 0 ? (
        <p className="hint-note">Nobody holds this yet.</p>
      ) : (
        <div className="ur-table-scroll">
          <table className="data-table ur-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name || "—"}
                    {a.id === selfId && (
                      <span className="hint-note" style={{ marginLeft: 6 }}>
                        (you)
                      </span>
                    )}
                  </td>
                  <td>{a.email}</td>
                  <td className="right">
                    <button
                      type="button"
                      className="btn-danger-ghost small"
                      onClick={() => revoke(a.id)}
                      disabled={revokingId === a.id}
                    >
                      {revokingId === a.id ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revokeError && <p className="error-note">{revokeError}</p>}

      <p className="cp-card-sub" style={{ marginTop: 16 }}>
        Grant it to someone who already has an account (they need to have
        signed in at least once):
      </p>
      <Field label="Email address">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              grant();
            }
          }}
          placeholder="teammate@yourcompany.com"
          disabled={grantPending}
        />
      </Field>
      {grantError && <p className="error-note">{grantError}</p>}
      <div className="modal-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={grant}
          disabled={grantPending || !email.trim()}
        >
          {grantPending ? "Granting…" : "Grant"}
        </button>
      </div>
    </div>
  );
}

export function PlatformAdminView({
  admins,
  invites,
  now,
  selfId,
}: {
  admins: PlatformAdminRow[];
  invites: InviteHistoryRow[];
  now: number;
  selfId: string;
}) {
  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Platform Admin</h1>
          <p className="module-sub">Operating the platform, not a single company</p>
        </div>
      </div>

      <InviteBusinessCard />
      <InviteHistoryCard invites={invites} now={now} />
      <PlatformAdminsCard admins={admins} selfId={selfId} />
    </div>
  );
}
