"use client";

import { useState, useTransition } from "react";
import { emailCustomerStatement } from "@/lib/actions/statements";
import type { StatementPeriod } from "@/lib/data/customer-statement";

/** Email this statement to the customer (DECISIONS #153), after a check --
 *  for the period on screen (#159). */
export function EmailStatementButton({
  leadId,
  hasEmail,
  period,
  periodLabel,
}: {
  leadId: string;
  hasEmail: boolean;
  period: StatementPeriod;
  /** "for Sep 1, 2026 – Oct 6, 2026"; null for all of it. */
  periodLabel: string | null;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn-primary"
        disabled={pending || !hasEmail}
        title={hasEmail ? "Email this statement to the customer" : "This customer has no email address on file"}
        onClick={() => {
          const what = periodLabel ? `the statement ${periodLabel}` : "this statement";
          if (!window.confirm(`Email ${what} to the customer?`)) return;
          setNote(null);
          setError(null);
          startTransition(async () => {
            const res = await emailCustomerStatement(leadId, period);
            if (res.error) return setError(res.error);
            setNote(`Emailed to ${res.sentTo}.`);
          });
        }}
      >
        {pending ? "Sending…" : "Email statement"}
      </button>
      {note && <span className="hint-note">{note}</span>}
      {error && <span className="error-note">{error}</span>}
    </>
  );
}
