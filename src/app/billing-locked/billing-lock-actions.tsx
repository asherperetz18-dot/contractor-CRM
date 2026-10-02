"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openBillingPortal, recheckBilling, renewSubscription } from "@/lib/actions/billing";
import { openInCompany } from "@/lib/open-in-company";
import { switchCompany } from "@/lib/actions/company";
import { logout } from "@/lib/actions/auth";
import type { CompanyMembership } from "@/lib/data/profile";
import { WebOnly } from "@/components/web-only";

export function BillingLockActions({
  canManage,
  renewed,
  otherCompanies,
}: {
  canManage: boolean;
  renewed: boolean;
  otherCompanies: CompanyMembership[];
}) {
  const router = useRouter();
  // Back from a renewal checkout starts out busy: the check below is
  // already on its way.
  const [busy, setBusy] = useState(renewed);
  const [message, setMessage] = useState<string | null>(
    renewed ? "Confirming your payment with Stripe…" : null
  );

  async function goTo(action: () => Promise<{ url?: string; error?: string }>) {
    setBusy(true);
    setMessage(null);
    const res = await action();
    if (res.url) {
      window.location.href = res.url;
      return;
    }
    setMessage(res.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  function afterRecheck(res: { locked: boolean; error?: string }) {
    if (!res.locked) {
      router.replace("/");
      return;
    }
    setMessage(
      res.error ??
        "Stripe still shows the subscription as ended. If you just paid, give it a minute and check again."
    );
    setBusy(false);
  }

  async function recheck() {
    setBusy(true);
    setMessage(null);
    afterRecheck(await recheckBilling());
  }

  // Back from a renewal checkout: the webhook may not have landed yet, so
  // ask Stripe straight away rather than leaving them on a lock screen
  // they just paid to get past.
  useEffect(() => {
    if (renewed) void recheckBilling().then(afterRecheck);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-form">
      {canManage ? (
        // Paying happens outside the Play Store app, and the app may not
        // point there either (DECISIONS #087).
        <WebOnly fallback={<p className="hint-note">The subscription can&apos;t be renewed in the app.</p>}>
          <button
            type="button"
            className="btn-primary auth-submit"
            disabled={busy}
            onClick={() => goTo(renewSubscription)}
          >
            Renew subscription
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => goTo(openBillingPortal)}
          >
            Card declined? Update it and see invoices
          </button>
        </WebOnly>
      ) : (
        <p className="hint-note">Ask your company&apos;s Office or Admin user to renew it.</p>
      )}

      <button type="button" className="btn-ghost" disabled={busy} onClick={recheck}>
        Already paid? Check again
      </button>

      {message && <p className="error-note">{message}</p>}

      {otherCompanies.map((c) => (
        <button
          key={c.company_id}
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await switchCompany(c.company_id);
            openInCompany();
          }}
        >
          Switch to {c.company_name ?? "another company"}
        </button>
      ))}

      <form action={logout}>
        <button type="submit" className="btn-ghost" style={{ width: "100%" }}>
          Sign out
        </button>
      </form>
    </div>
  );
}
