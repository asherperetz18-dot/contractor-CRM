"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createReceiptUploadUrl } from "@/lib/actions/job-expenses";
import { createBillWithPayments, createVendorBills } from "@/lib/actions/vendor-bills";
import { getPaymentAccounts } from "@/lib/actions/payment-accounts";
import type { PaymentAccount } from "@/lib/data/bills";
import { PaymentLines, linesForSave, newPaymentLine, type PaymentLineDraft } from "./payment-lines";
import { createVendor, getVendors } from "@/lib/actions/vendors";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { centsFromInput, moneyCents, vendorLabel, type Vendor } from "@/lib/data/types";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { useFileDrop } from "@/components/uploads/file-drop";
import { ContractPicker } from "./contract-picker";
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
 * there is one form with three answers to "Paid?": not yet (it lands in
 * Bills to Pay), in part, or in full. Paid money is entered as payment
 * lines -- method, the account it came out of, amount, check/ref number,
 * date -- one per payment, so $800 on the Amex and $300 by check is
 * recorded as exactly that. Every line becomes a bill payment and a job
 * cost the same day; whatever is left stays owing in Bills to Pay. That
 * is also how QuickBooks records a bill (a Bill, a Bill Payment each).
 *
 * Save bill saves and closes -- one bill, done. Save & add another
 * keeps the form open for the phone-at-the-counter case: a stack of
 * receipts goes in one after another, with the job, vendor and date
 * carrying over between them.
 */
export function AddBillModal({
  jobs,
  initialLeadId,
  initialEstimateId,
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
  /** The contract on that row, so "Which contract?" starts answered. */
  initialEstimateId?: string;
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
  /** Where "Paid?" starts: true is "Paid in full". */
  defaultPaid?: boolean;
  /** Vendor list, when the caller already has it; fetched otherwise. */
  vendors?: Vendor[];
  onSaved?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(initialLeadId || (jobs.length === 1 ? jobs[0].leadId : ""));
  const [phaseId, setPhaseId] = useState("");
  // Set by ContractPicker when the customer holds several contracts.
  const [contractRequired, setContractRequired] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>(vendorsProp ?? []);
  const [vendorId, setVendorId] = useState("");
  const [vendorText, setVendorText] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  // Anyone who can't run Bills to Pay (Field, Production) only records
  // money already out, in full -- they can't leave a bill owing.
  const [payMode, setPayMode] = useState<"unpaid" | "partial" | "full">(
    canBills ? ((defaultPaid ?? true) ? "full" : "unpaid") : "full"
  );
  const paid = payMode !== "unpaid";
  const [lines, setLines] = useState<PaymentLineDraft[]>(() => [newPaymentLine(today())]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [file, setFile] = useState<File | null>(null);
  // The emailed PDF or receipt photo can be dragged straight onto the row.
  const { dragOver: receiptDragOver, dropProps: receiptDropProps } = useFileDrop((files) =>
    setFile(files[0])
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getPaymentAccounts().then((res) => setAccounts(res.accounts));
  }, []);

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
    if (!leadId && !allowNoJob) return setError("Pick the job this bill belongs to.");
    if (leadId && !phases && contractRequired && !phaseId) {
      return setError("Pick which contract this bill is for.");
    }
    if (!cents) return setError("Enter the amount.");
    if (!date) return setError("Enter the date.");
    if (vendorId === "__new") return setError("Save the new vendor first, or pick one from the list.");
    if (!vendorId && !vendorText.trim()) return setError("Name the vendor.");
    const payments = linesForSave(lines, cents, payMode === "full");
    if (paid) {
      const sum = payments.reduce((t, l) => t + l.amountCents, 0);
      if (payments.some((l) => !l.amountCents)) return setError("Every payment needs an amount.");
      if (sum > cents) return setError("The payments add up to more than the bill.");
      if (payMode === "full" && sum < cents) {
        return setError("Paid in full: the payments must add up to the whole bill — or pick “Paid in part”.");
      }
    }
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

      const bill = {
        vendorId: vendorId || null,
        vendorName: vendorText,
        leadId: leadId || null,
        // Only when a phase was actually picked. Sending null would
        // still write the column, and on a database where migration
        // 0123 hasn't run yet that column doesn't exist.
        estimatePaymentId: phaseId || undefined,
        reference: description,
        amountCents: cents,
        billDate: date,
        dueDate: dueDate || null,
        receipt: uploaded,
      };
      const res = paid
        ? await createBillWithPayments({ ...bill, payments })
        : await createVendorBills([bill]);
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
      // Same method, account and date for the next receipt; fresh amounts.
      setLines((ls) => [{ ...ls[0], amount: "", reference: "" }]);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      const left = "leftCents" in res ? (res.leftCents ?? 0) : cents;
      setSavedNote(
        `Saved ${moneyCents(cents)}${
          !paid ? " to Bills to Pay" : left > 0 ? ` — ${moneyCents(left)} left in Bills to Pay` : " — paid in full"
        }. Add the next one.`
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
          A receipt is a bill that&rsquo;s already paid. What&rsquo;s paid goes to the job&rsquo;s
          costs now; anything not paid yet waits in Bills to Pay.
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
                <option value="">{allowNoJob ? "No job — overhead" : "Choose a job…"}</option>
                {jobs.map((j) => (
                  <option key={j.leadId} value={j.leadId}>
                    {j.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!phases && leadId && (
            <ContractPicker
              leadId={leadId}
              value={phaseId}
              onChange={setPhaseId}
              preferEstimateId={leadId === initialLeadId ? initialEstimateId : undefined}
              onRequired={setContractRequired}
            />
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
            <Field label="Bill total">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Bill date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {payMode !== "full" && (
              <Field label="Due date">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}
          </div>

          {unpaidAllowed ? (
            // Not <Field>: that is a <label>, and a click on its text would
            // press the first button inside it.
            <div className="field">
              <span className="field-label">Paid?</span>
              <div className="bill-pay-mode" role="radiogroup" aria-label="Paid?">
                {(
                  [
                    ["unpaid", "Not paid yet"],
                    ["partial", "Paid in part"],
                    ["full", "Paid in full"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={payMode === mode}
                    className={payMode === mode ? "on" : ""}
                    onClick={() => setPayMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="est-tax-note">
                {payMode === "unpaid"
                  ? "Goes to Bills to Pay. It joins the job's costs the day you pay it."
                  : payMode === "partial"
                    ? "What's paid goes into the job's costs now; the rest waits in Bills to Pay."
                    : "Goes straight into the job's costs (Spent)."}
              </span>
            </div>
          ) : (
            <p className="est-tax-note" style={{ margin: 0 }}>
              Paid in full — how was it paid?
            </p>
          )}
          {paid && (
            <PaymentLines
              lines={lines}
              onChange={setLines}
              accounts={accounts}
              totalCents={centsFromInput(amount)}
              full={payMode === "full"}
            />
          )}
        </div>

        <div
          className={`bill-file-row panel-drop${receiptDragOver ? " drag-over" : ""}`}
          {...receiptDropProps}
        >
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
            📷{" "}
            {receiptDragOver
              ? "Drop the receipt"
              : file
                ? "Change the receipt"
                : "Snap, attach or drop the receipt"}
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
