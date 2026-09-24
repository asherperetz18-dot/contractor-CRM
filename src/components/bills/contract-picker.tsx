"use client";

import { useEffect, useMemo, useState } from "react";
import { getJobFilingOptions } from "@/lib/actions/job-expenses";
import { Field } from "@/components/ui/field";
import type { ContractFilingOption } from "@/lib/data/types";

/**
 * "Which contract?" for a bill, shown only when the customer holds more
 * than one contract. With one, an unfiled cost is already that
 * contract's; with two or more, a bill left unfiled counts toward
 * neither, and the commission report reads "costs not recorded" however
 * many receipts are in. The value is a phase id -- a cost belongs to a
 * contract through one of its phases.
 */
export function ContractPicker({
  leadId,
  value,
  onChange,
  preferEstimateId,
  onRequired,
}: {
  leadId: string;
  value: string;
  onChange: (phaseId: string) => void;
  /** Opened from a project row: that row's contract, picked for you. */
  preferEstimateId?: string;
  /** Tells the form whether a choice is required before saving. */
  onRequired: (required: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<{ leadId: string; options: ContractFilingOption[] } | null>(
    null
  );
  const options = useMemo(
    () => (loaded?.leadId === leadId ? loaded.options : []),
    [loaded, leadId]
  );
  const required = options.length > 1;

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    getJobFilingOptions(leadId).then((res) => {
      if (!cancelled) setLoaded({ leadId, options: res.options ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    onRequired(required);
  }, [required, onRequired]);

  // The project row already said which contract; start on its first phase.
  useEffect(() => {
    if (!required || value || !preferEstimateId) return;
    const first = options.find((o) => o.estimateId === preferEstimateId)?.phases[0];
    if (first) onChange(first.id);
  }, [required, value, preferEstimateId, options, onChange]);

  if (!required) return null;
  return (
    <Field label="Which contract?">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose the contract…</option>
        {options.map((o) => (
          <optgroup key={o.estimateId} label={o.label}>
            {o.phases.map((p) => (
              <option key={p.id} value={p.id}>
                {o.label.split(" · ")[0]} — {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}
