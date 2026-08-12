"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { vendorInsuranceState, type Vendor } from "@/lib/data/types";
import { createVendor, setVendorActive, updateVendor, type VendorFields } from "@/lib/actions/vendors";

const BLANK: VendorFields = {
  name: "",
  trade: "",
  defaultCategory: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  licenseNumber: "",
  insuranceExpiresOn: "",
  w9OnFile: false,
  w9ReceivedOn: "",
  notes: "",
};

function toFields(v: Vendor): VendorFields {
  return {
    name: v.name,
    trade: v.trade ?? "",
    defaultCategory: v.default_category ?? "",
    contactName: v.contact_name ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    address: v.address ?? "",
    licenseNumber: v.license_number ?? "",
    insuranceExpiresOn: v.insurance_expires_on ?? "",
    w9OnFile: v.w9_on_file,
    w9ReceivedOn: v.w9_received_on ?? "",
    notes: v.notes ?? "",
  };
}

function InsuranceFlag({ vendor }: { vendor: Vendor }) {
  const state = vendorInsuranceState(vendor);
  // No date is not a failing grade. A lumber yard has no reason to carry
  // a certificate on your file, and flagging every supplier would teach
  // everyone to ignore the flag that matters.
  if (state === "none") return <span className="est-tax-note">—</span>;
  const when = new Date(vendor.insurance_expires_on + "T00:00:00").toLocaleDateString("en-US");
  if (state === "expired") return <span className="stale-tag">Expired {when}</span>;
  if (state === "expiring") return <span className="source-tag">Expires {when}</span>;
  return <span className="est-tax-note">{when}</span>;
}

/**
 * The vendor list, and the compliance dates that come with subs.
 *
 * Tax IDs are deliberately absent. EINs and SSNs belong in QuickBooks,
 * which is built to hold them; this records only whether the W-9 is on
 * file, which answers the question actually asked in January without the
 * CRM ever storing the number.
 */
export function VendorsView({ vendors, canEdit }: { vendors: Vendor[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState<VendorFields>(BLANK);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const active = vendors.filter((v) => v.is_active);
  const archived = vendors.filter((v) => !v.is_active);
  const lapsed = active.filter((v) => vendorInsuranceState(v) === "expired");

  function open(v: Vendor | null) {
    setError("");
    setEditing(v ? v.id : "new");
    setFields(v ? toFields(v) : BLANK);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const res =
        editing === "new" ? await createVendor(fields) : await updateVendor(editing!, fields);
      if (res.error) return setError(res.error);
      setEditing(null);
      router.refresh();
    });
  }

  function set(patch: Partial<VendorFields>) {
    setFields((f) => ({ ...f, ...patch }));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="page-sub">
            Suppliers and subcontractors. Picking one on a cost keeps the spend under a single
            name instead of three spellings of it.
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => open(null)} disabled={pending}>
            + New vendor
          </button>
        )}
      </div>

      {lapsed.length > 0 && (
        <div className="dash-panel digest-urgent" style={{ marginBottom: 14 }}>
          <div className="cp-tz-head">
            <span>
              Insurance lapsed{" "}
              <span className="count-pill count-pill-urgent">{lapsed.length}</span>
            </span>
          </div>
          <p className="module-sub" style={{ margin: "4px 0 0" }}>
            {/* Explicit space: JSX drops the one between an expression and
                the text after it, which ran the vendor's name into the
                dash -- "QA Home Depot— a sub working…". */}
            {lapsed.map((v) => v.name).join(", ")}
            {" — "}a sub working your job without live cover is your exposure, not theirs.
            Ask for the new certificate before they are back on site.
          </p>
        </div>
      )}

      {editing && (
        <div className="second-contact-block" style={{ marginBottom: 14 }}>
          <div className="second-contact-head">
            <span>{editing === "new" ? "New vendor" : "Edit vendor"}</span>
            <span className="est-tax-note">
              No tax ID field on purpose &mdash; keep EINs and SSNs in QuickBooks
            </span>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">Name *</span>
              <input value={fields.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Trade</span>
              <input
                placeholder="Lumber, Electrical sub…"
                value={fields.trade}
                onChange={(e) => set({ trade: e.target.value })}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">Usual expense category</span>
              <input
                placeholder="Job Materials"
                value={fields.defaultCategory}
                onChange={(e) => set({ defaultCategory: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Contact name</span>
              <input
                value={fields.contactName}
                onChange={(e) => set({ contactName: e.target.value })}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">Phone</span>
              <input value={fields.phone} onChange={(e) => set({ phone: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input value={fields.email} onChange={(e) => set({ email: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Address</span>
            <input value={fields.address} onChange={(e) => set({ address: e.target.value })} />
          </label>

          <div className="form-row">
            <label className="field">
              <span className="field-label">Licence number</span>
              <input
                placeholder="CSLB number, for subs"
                value={fields.licenseNumber}
                onChange={(e) => set({ licenseNumber: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Insurance expires</span>
              <input
                type="date"
                value={fields.insuranceExpiresOn}
                onChange={(e) => set({ insuranceExpiresOn: e.target.value })}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">W-9</span>
              <select
                value={fields.w9OnFile ? "yes" : "no"}
                onChange={(e) => set({ w9OnFile: e.target.value === "yes" })}
              >
                <option value="no">Not on file</option>
                <option value="yes">On file</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">W-9 received</span>
              <input
                type="date"
                value={fields.w9ReceivedOn}
                onChange={(e) => set({ w9ReceivedOn: e.target.value })}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              rows={2}
              value={fields.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>

          {error && <p className="error-note">{error}</p>}
          <button className="btn-primary small" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save vendor"}
          </button>
          <button
            className="btn-ghost small"
            onClick={() => setEditing(null)}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      )}

      {vendors.length === 0 && !editing ? (
        <p className="empty-hint">
          No vendors yet. Add one here, or create it inline the first time you enter a cost for
          them.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Contact</th>
                <th>Licence</th>
                <th>Insurance</th>
                <th>W-9</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...archived].map((v) => (
                <tr key={v.id} style={v.is_active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <div className="ur-name">{v.name}</div>
                    <div className="est-tax-note">
                      {[v.trade, v.default_category].filter(Boolean).join(" · ") || "—"}
                      {!v.is_active && " · archived"}
                    </div>
                  </td>
                  <td>
                    {v.contact_name || "—"}
                    {v.phone && <div className="est-tax-note">{v.phone}</div>}
                    {v.email && <div className="est-tax-note">{v.email}</div>}
                  </td>
                  <td className="mono">{v.license_number || "—"}</td>
                  <td>
                    <InsuranceFlag vendor={v} />
                  </td>
                  <td>
                    {v.w9_on_file ? (
                      <span className="est-tax-note">
                        On file
                        {v.w9_received_on &&
                          ` · ${new Date(v.w9_received_on + "T00:00:00").toLocaleDateString("en-US")}`}
                      </span>
                    ) : (
                      <span className="source-tag">Missing</span>
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <>
                        <button className="btn-ghost small" onClick={() => open(v)}>
                          Edit
                        </button>
                        {/* Archive, never delete: a vendor with costs
                            against it must not vanish from last year's
                            job because nobody buys from them now. */}
                        <button
                          className="btn-ghost small"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const res = await setVendorActive(v.id, !v.is_active);
                              if (res.error) return setError(res.error);
                              router.refresh();
                            })
                          }
                        >
                          {v.is_active ? "Archive" : "Restore"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
