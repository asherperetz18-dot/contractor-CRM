"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchCompany, createCompany } from "@/lib/actions/company";
import type { CompanyMembership } from "@/lib/data/profile";

export function CompanySwitcher({
  companies,
  currentCompanyId,
  canCreate,
}: {
  companies: CompanyMembership[];
  currentCompanyId: string;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const current = companies.find((c) => c.company_id === currentCompanyId);

  if (companies.length <= 1 && !canCreate) return null;

  async function handleSwitch(companyId: string) {
    if (companyId === currentCompanyId) {
      setOpen(false);
      return;
    }
    setPending(true);
    const result = await switchCompany(companyId);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setPending(true);
    setError("");
    const result = await createCompany(trimmed);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewName("");
    setCreating(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="quick-create-wrap">
      <button
        className="icon-btn topbar-icon-btn company-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        title="Switch company"
      >
        🏢 <span className="company-switcher-label">{current?.company_name || "Company"}</span>
      </button>
      {open && (
        <>
          <div
            className="quick-create-backdrop"
            onClick={() => {
              setOpen(false);
              setCreating(false);
              setError("");
            }}
          />
          <div className="quick-create-menu">
            <div className="qc-group">
              <div className="qc-group-label">COMPANIES</div>
              {companies.map((c) => (
                <div
                  key={c.company_id}
                  className="qc-item"
                  onClick={() => handleSwitch(c.company_id)}
                >
                  {c.company_id === currentCompanyId ? "✓ " : ""}
                  {c.company_name || "Unnamed company"}
                </div>
              ))}
              {canCreate && !creating && (
                <div className="qc-item" onClick={() => setCreating(true)}>
                  + New company
                </div>
              )}
              {canCreate && creating && (
                <div className="rep-text-row" style={{ padding: "8px 12px" }}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCreate();
                      }
                    }}
                    placeholder="Company name"
                    autoFocus
                    disabled={pending}
                  />
                  <button
                    type="button"
                    className="btn-primary small"
                    onClick={handleCreate}
                    disabled={pending}
                  >
                    {pending ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                      setError("");
                    }}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {error && <p className="error-note" style={{ padding: "0 12px" }}>{error}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
