"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { sendManualSignupInvite } from "@/lib/actions/admin-invite";
import { grantPlatformAdmin, revokePlatformAdmin } from "@/lib/actions/platform-admin";
import type { PlatformAdminRow } from "@/lib/data/platform-admin";

function InviteBusinessCard() {
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
        Separate from being Office or Admin of any one company. Holding this
        is what lets someone invite a business above, and grant or revoke this
        same access on someone else.
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
  selfId,
}: {
  admins: PlatformAdminRow[];
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
      <PlatformAdminsCard admins={admins} selfId={selfId} />
    </div>
  );
}
