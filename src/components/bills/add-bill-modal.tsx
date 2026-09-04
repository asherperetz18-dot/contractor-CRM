"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createJobExpense, createReceiptUploadUrl } from "@/lib/actions/job-expenses";
import { createVendorBills } from "@/lib/actions/vendor-bills";
import { createVendor, getVendors } from "@/lib/actions/vendors";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { centsFromInput, moneyCents, vendorLabel, type Vendor } from "@/lib/data/types";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import "@/components/ui/receipt-thumb.css";

export type BillJobOption = { leadId: string; label: string };
export type BillPhaseOption = { id: string; name: string };

/**
 * One entry per customer, not per contract: costs hang off the lead,
 * and listing a customer's contract and its change orders separately
 * would just be the same pile twice. A customer running several job
 * sites is labelled by count rather than by whichever site's contract
 * happened to sort first -- that address would be arbitrary.
 */
export function jobOptionsFromProjects(
  projects: { leadId: string; customer: string; address: string | null; status: string }[]
): BillJobOption[] {
  const byLead = new Map<string, { leadId: string; customer: string; addresses: Set<string> }>();
  for (const p of projects) {
    if (p.status === "cancelled") continue;
    const entry = byLead.get(p.leadId) ?? { leadId: p.leadId, customer: p.customer, addresses: new Set<string>() };
    if (p.address) entry.addresses.add(p.address);
    byLead.set(p.leadId, entry);
  }
  return [...byLead.values()].map((e) => ({
    leadId: e.leadId,
    label:
      e.customer +
      (e.addresses.size > 1
        ? ` — ${e.addresses.size} job sites`
        : e.addresses.size === 1
          ? ` — ${[...e.addresses][0]}`
          : ""),
  }));
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The one form for money going out on a job, used from Bills to Pay,
 * Projects and the contract's Job costs alike.
 *
 * A receipt and a bill are the same thing at two moments: a bill is
 * what the vendor is owed, a receipt is that bill once it is paid. So
 * there is one form with one switch -- "Already paid". Off, the entry
 * lands in Bills to Pay and becomes a job cost the day it is paid. On,
 * it goes straight to the job's costs, the way a receipt snapped at the
 * supply-house counter should.
 *
 * Save bill saves and closes -- one bill, done. Save & add another
 * keeps the form open for the phone-at-the-counter case: a stack of
 * receipts goes in one after another, with the job, vendor and date
 * carrying over between them.
 */
export function AddBillModal({
  jobs,
  initialLeadId,
  lockJob,
  phases,
  canBills,
  allowNoJob,
  defaultPaid,
  vendors: vendorsProp,
  onSaved,
  onClose,
}: {
  jobs: BillJobOption[];
  /** Pre-picked job, when the modal was opened from a specific row. */
  initialLeadId?: string;
  /** The job is fixed (opened from inside one contract). */
  lockJob?: boolean;
  /** The job's payment phases, when the caller knows them. */
  phases?: BillPhaseOption[];
  /** May this user file an UNPAID bill? (Bookkeeping, Office, Admin.)
   *  Field and Production only record what was already paid, so the
   *  switch is hidden and locked on for them. */
  canBills: boolean;
  /** Bills to Pay: an overhead bill with no job (fuel, the office). */
  allowNoJob?: boolean;
  /** Where the "Already paid" switch starts. */
  defaultPaid?: boolean;
  /** Vendor list, when the caller already has it; fetched otherwise. */
  vendors?: Vendor[];
  onSaved?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(initialLeadId || (jobs.length === 1 ? jobs[0].leadId : ""));
  const [phaseId, setPhaseId] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>(vendorsProp ?? []);
  const [vendorId, setVendorId] = useState("");
  const [vendorText, setVendorText] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [paid, setPaid] = useState(canBills ? (defaultPaid ?? true) : true);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (vendorsProp) return;
    getVendors().then((res) => setVendors(res.vendors ?? []));
  }, [vendorsProp]);

  // A preview of the chosen photo, right in the form, so the wrong
  // receipt is caught before it is saved rather than after.
  const filePreview = useMemo(
    () => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const unpaidAllowed = canBills;

  async function saveVendor() {
    if (!newVendorName.trim()) return setError("Type the vendor's name.");
    setError("");
    setSaving(true);
    try {
      const res = await createVendor({ name: newVendorName.trim(), trade: "", defaultCategory: "", phone: "" });
      const v = res.vendor ?? res.duplicateOf;
      if (!v) return setError(res.error ?? "Couldn't save the vendor.");
      setVendors((list) =>
        (list.some((x) => x.id === v.id) ? list : [...list, v]).sort((a, b) => a.name.localeCompare(b.name))
      );
      setVendorId(v.id);
      setVendorText("");
      setNewVendorName("");
    } finally {
      setSaving(false);
    }
  }

  async function save(andAnother = false) {
    const cents = centsFromInput(amount);
    if (!leadId && (paid || !allowNoJob)) {
      return setError(
        paid && allowNoJob
          ? "Pick the job — or switch off “Already paid” to file it as an overhead bill."
          : "Pick the job this bill belongs to."
      );
    }
    if (!cents) return setError("Enter the amount.");
    if (!date) return setError("Enter the date.");
    if (vendorId === "__new") return setError("Save the new vendor first, or pick one from the list.");
    if (!paid && !vendorId && !vendorText.trim()) return setError("Name the vendor.");
    setError("");
    setSavedNote("");
    setSaving(true);
    try {
      // The file goes straight to storage first, like lead files: a
      // phone photo routinely beats the body limit a server action
      // would hit. Camera shots shrink in the browser; PDFs pass through.
      let uploaded: { path: string; fileName: string; contentType: string | null } | null = null;
      if (file) {
        const shrunk = await downscaleImage(file);
        const signed = await createReceiptUploadUrl(leadId || null, shrunk.name, shrunk.size);
        if (signed.error || !signed.path || !signed.token) {
          return setError(signed.error ?? "Could not start the receipt upload.");
        }
        const { error: uploadError } = await createBrowserClient()
          .storage.from("lead-files")
          .uploadToSignedUrl(signed.path, signed.token, shrunk, {
            contentType: shrunk.type || undefined,
          });
        if (uploadError) return setError(uploadError.message);
        uploaded = { path: signed.path, fileName: shrunk.name, contentType: shrunk.type || null };
      }

      const res = paid
        ? await createJobExpense(
            {
              leadId,
              estimatePaymentId: phaseId || null,
              vendorId: vendorId || null,
              vendor: vendorText,
              category: vendor?.default_category ?? "",
              description,
              amountCents: cents,
              spentOn: date,
            },
            uploaded
          )
        : await createVendorBills([
            {
              vendorId: vendorId || null,
              vendorName: vendorText,
              leadId: leadId || null,
              // Only when a phase was actually picked. Sending null would
              // still write the column, and on a database where migration
              // 0123 hasn't run yet that column doesn't exist -- the save
              // failed on the Bills page, which has no phase picker at all.
              estimatePaymentId: phaseId || undefined,
              reference: description,
              amountCents: cents,
              billDate: date,
              dueDate: dueDate || null,
              receipt: uploaded,
            },
          ]);
      if (res.error) return setError(res.error);

      onSaved?.();
      router.refresh();
      if (!andAnother) {
        // The normal case: saved, close, back to the page.
        onClose();
        return;
      }
      // Job, vendor, date and the paid switch stay -- the next one in the
      // stack is usually from the same counter on the same day.
      setAmount("");
      setDescription("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setSavedNote(
        `Saved ${moneyCents(cents)} ${paid ? "to the job's costs" : "to Bills to Pay"} — add the next one.`
      );
    } catch {
      // Flaky site cellular is this form's home turf. Without a catch a
      // rejected fetch just stops the spinner and says nothing.
      setError("Didn't save — check your signal and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // A stray thumb on the backdrop mid-upload must not tear the modal
    // down while the save is in flight.
    <Modal title="Add a bill" onClose={() => { if (!saving) onClose(); }}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <p className="module-sub" style={{ marginTop: 0, marginBottom: 12 }}>
          A receipt is a bill that&rsquo;s already paid. Paid goes to the job&rsquo;s costs;
          not paid yet goes to Bills to Pay and lands on the job when you pay it.
        </p>
        <div className="qr-form">
          {lockJob && (
            <Field label="Job">
              <input value={jobs.find((j) => j.leadId === leadId)?.label ?? ""} readOnly />
            </Field>
          )}
          {!lockJob && (
            <Field label="Job">
              <select value={leadId} onChange={(e) => { setLeadId(e.target.value); setPhaseId(""); }}>
                <option value="">{allowNoJob && !paid ? "No job — overhead" : "Choose a job…"}</option>
                {jobs.map((j) => (
                  <option key={j.leadId} value={j.leadId}>
                    {j.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {phases && phases.length > 0 && leadId && (
            <Field label="Phase">
              <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
                <option value="">Not filed to a phase yet</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Vendor">
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                if (e.target.value) setVendorText("");
              }}
            >
              <option value="">Not on the list</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorLabel(v)}
                </option>
              ))}
              <option value="__new">+ Add to the vendor list…</option>
            </select>
          </Field>
          {vendorId === "__new" ? (
            <Field label="New vendor">
              <div className="qr-pair">
                <input
                  placeholder="e.g. Home Depot"
                  autoFocus
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  style={{ flex: "1 1 160px" }}
                />
                <button type="button" className="btn-primary small" onClick={saveVendor}>
                  Save vendor
                </button>
                <button type="button" className="btn-ghost small" onClick={() => setVendorId("")}>
                  Cancel
                </button>
              </div>
            </Field>
          ) : (
            !vendorId && (
              <Field label="Vendor name">
                <input
                  placeholder="e.g. Home Depot"
                  value={vendorText}
                  onChange={(e) => setVendorText(e.target.value)}
                />
              </Field>
            )
          )}
          <Field label="What for">
            <input
              placeholder="e.g. Drywall + mud"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="qr-pair">
            <Field label="Amount">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={paid ? "Date paid" : "Bill date"}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {!paid && (
              <Field label="Due date">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}
          </div>

          {unpaidAllowed && (
            <label className="bill-paid-toggle">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              <span>
                <strong>{paid ? "Already paid" : "Not paid yet"}</strong>
                <span className="est-tax-note">
                  {paid
                    ? "Goes straight into the job's costs (Spent)."
                    : "Goes to Bills to Pay. It joins the job's costs the day you pay it."}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="bill-file-row">
          {/* No capture attribute: phones that honor it jump straight
              into the camera with no way back to the file picker, and
              the vendor's emailed PDF is half the point. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="btn-ghost small" onClick={() => fileInput.current?.click()}>
            📷 {file ? "Change the receipt" : "Snap or attach the receipt"}
          </button>
          {file && filePreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bill-file-preview" src={filePreview} alt="Receipt preview" />
          )}
          {file && (
            <span className="est-tax-note" style={{ wordBreak: "break-all", minWidth: 0 }}>
              {file.name}{" "}
              <button
                type="button"
                className="btn-ghost est-row-remove"
                aria-label="Remove receipt"
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                ×
              </button>
            </span>
          )}
        </div>

        {error && <p className="error-note">{error}</p>}
        {savedNote && !error && <p className="hint-note">{savedNote}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" className="btn-primary" onClick={() => void save(false)}>
            {saving ? "Saving…" : "Save bill"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void save(true)}>
            Save &amp; add another
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}
