"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setCompanyDefaultLeadCost } from "@/lib/actions/lead-field-options";
import { leadCostInputValue } from "@/lib/data/lead-source-cost";

/**
 * The company-wide fallback: what a new lead costs when nobody typed a
 * figure and its source has none of its own. $375 since 0089, and until
 * now editable only by SQL. Saves when you leave the box or press Enter.
 */
export function CompanyDefaultLeadCost({ initial }: { initial: number | null }) {
  const router = useRouter();
  const stored = leadCostInputValue(initial);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (draft.trim() === stored) return;
    setSaving(true);
    setError("");
    const result = await setCompanyDefaultLeadCost(draft);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="stage-create-panel">
      <label className="field">
        <span className="field-label">Default lead cost</span>
        <span className="lead-cost-box">
          <span>$</span>
          <input
            className="lead-cost-input"
            inputMode="decimal"
            value={draft}
            placeholder="none"
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </span>
      </label>
      <p className="hint-note">
        Put on every new lead that arrives without a cost, when its source has no cost of its own
        above. Leave blank for no default. Leads already priced are never changed.
      </p>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
