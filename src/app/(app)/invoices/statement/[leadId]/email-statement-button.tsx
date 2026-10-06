"use client";

import { useState, useTransition } from "react";
import { emailCustomerStatement } from "@/lib/actions/statements";

/** Email this statement to the customer (DECISIONS #153), after a check. */
export function EmailStatementButton({ leadId, hasEmail }: { leadId: string; hasEmail: boolean }) {
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
          if (!window.confirm("Email this statement to the customer?")) return;
          setNote(null);
          setError(null);
          startTransition(async () => {
            const res = await emailCustomerStatement(leadId);
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
