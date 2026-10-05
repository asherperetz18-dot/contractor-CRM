"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { saveRoleNames, type RoleNamesSettings } from "@/lib/actions/settings";
import { FIXED_ROLES, MAX_ROLE_NAME_LENGTH, RENAMEABLE_ROLES, storedRoleNames } from "@/lib/role-names";
import type { AppRole } from "@/lib/data/types";

/** A few names other contractors use, offered as you type. Any name can be typed. */
const SUGGESTIONS: Partial<Record<AppRole, string[]>> = {
  Field: ["Crew", "Installers", "Technicians", "Field Crew"],
  Sales: ["Sales Reps", "Technicians", "Estimators", "Consultants", "Energy Consultants"],
  "Call Center": ["Front Desk", "Appointment Setters", "Customer Service"],
  Dispatch: ["Scheduling", "Coordinators", "Dispatchers"],
  Bookkeeping: ["Accounting", "Billing", "Finance"],
  Production: ["Operations", "Project Managers", "Install Team"],
};

/**
 * Settings › Role Names (DECISIONS #137): a name for each team role the
 * company can rename. Left blank, a role goes back to its standard name.
 */
export function RoleNamesForm({ initial }: { initial: RoleNamesSettings }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(RENAMEABLE_ROLES.map((r) => [r, initial.names[r] === r ? "" : initial.names[r]]))
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checked as you type, with the same rules the save uses.
  const checked = storedRoleNames(names);
  const problem = "error" in checked ? checked.error : null;

  function update(role: AppRole, value: string) {
    setNames((n) => ({ ...n, [role]: value }));
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    setPending(true);
    const res = await saveRoleNames(names);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="cp-card">
      {!initial.ready && (
        <p className="error-note">
          Role names need a database update before they can be saved (0202_company_role_names.sql). Until
          then every role shows its standard name.
        </p>
      )}
      {RENAMEABLE_ROLES.map((role) => (
        <div key={role} className="words-row">
          <Field label={role}>
            <input
              value={names[role] ?? ""}
              maxLength={MAX_ROLE_NAME_LENGTH}
              placeholder={role}
              list={`role-name-${role.replace(/\s+/g, "-")}`}
              onChange={(e) => update(role, e.target.value)}
              aria-label={`Name for the ${role} role`}
            />
          </Field>
          <datalist id={`role-name-${role.replace(/\s+/g, "-")}`}>
            {(SUGGESTIONS[role] ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="cp-hint">Leave blank to keep &ldquo;{role}&rdquo;.</p>
        </div>
      ))}
      <p className="hint-note">
        {FIXED_ROLES.join(" and ")} keep their names: the app&apos;s messages refer to them by name, e.g.
        &ldquo;ask an Office or Admin user&rdquo;.
      </p>

      <div className="modal-actions">
        <div>
          {saved && <span className="cp-saved">✓ Saved</span>}
          {(error || problem) && <span className="error-note">{error || problem}</span>}
        </div>
        <div>
          <button className="btn-primary" onClick={handleSave} disabled={pending || !!problem || !initial.ready}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
