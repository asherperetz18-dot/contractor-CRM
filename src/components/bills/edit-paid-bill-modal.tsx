"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createReceiptUploadUrl,
  deleteJobExpense,
  setJobExpenseReceipt,
  updateJobExpense,
} from "@/lib/actions/job-expenses";
import { getVendors } from "@/lib/actions/vendors";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { centsFromInput, moneyCents, vendorLabel, type JobExpense, type Vendor } from "@/lib/data/types";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { useFileDrop } from "@/components/uploads/file-drop";
import type { BillJobOption } from "./add-bill-modal";
import type { UploadedReceipt } from "@/lib/receipts";
import "@/components/ui/receipt-thumb.css";

/** Straight to storage from the browser, like every receipt: a phone
 *  photo would beat a server action's body limit. */
async function uploadReceipt(
  file: File,
  leadId: string
): Promise<{ error: string } | { receipt: UploadedReceipt }> {
  const shrunk = await downscaleImage(file);
  const signed = await createReceiptUploadUrl(leadId, shrunk.name, shrunk.size);
  if (signed.error || !signed.path || !signed.token) {
    return { error: signed.error ?? "Could not start the receipt upload." };
  }
  const { error } = await createBrowserClient()
    .storage.from("lead-files")
    .uploadToSignedUrl(signed.path, signed.token, shrunk, { contentType: shrunk.type || undefined });
  if (error) return { error: error.message };
  return { receipt: { path: signed.path, fileName: shrunk.name, contentType: shrunk.type || null } };
}

/**
 * Fixes a bill saved as "Already paid": job, vendor, what for, amount,
 * date paid, the receipt -- or deletes it. Opened from Bills to Pay's
 * Paid tab and the project's Bills window alike.
 */
export function EditPaidBillModal({
  expense,
  jobs,
  vendors: vendorsProp,
  onSaved,
  onClose,
}: {
  expense: JobExpense;
  jobs: BillJobOption[];
  vendors?: Vendor[];
  onSaved?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(expense.lead_id);
  const [vendors, setVendors] = useState<Vendor[]>(vendorsProp ?? []);
  const [vendorId, setVendorId] = useState(expense.vendor_id ?? "");
  const [vendorText, setVendorText] = useState(expense.vendor ?? "");
  const [description, setDescription] = useState(expense.description ?? "");
  const [amount, setAmount] = useState((expense.amount_cents / 100).toFixed(2));
  const [date, setDate] = useState(expense.spent_on);
  const [file, setFile] = useState<File | null>(null);
  const { dragOver, dropProps } = useFileDrop((files) => setFile(files[0]));
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (vendorsProp) return;
    getVendors().then((res) => setVendors(res.vendors ?? []));
  }, [vendorsProp]);

  const filePreview = useMemo(
    () => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  // A job the picker doesn't list (a contract since voided) must still
  // show as the current value, or the select renders blank.
  const jobOptions = jobs.some((j) => j.leadId === expense.lead_id)
    ? jobs
    : [{ leadId: expense.lead_id, label: "Current job" }, ...jobs];
  const vendorName =
    (expense.vendor_id && vendors.find((v) => v.id === expense.vendor_id)?.name) ||
    expense.vendor ||
    "bill";

  async function finish() {
    onSaved?.();
    router.refresh();
    onClose();
  }

  async function save() {
    const cents = centsFromInput(amount);
    if (!cents) return setError("Enter the amount.");
    if (!date) return setError("Enter the date paid.");
    setError("");
    setSaving(true);
    try {
      let receipt: UploadedReceipt | null = null;
      if (file) {
        const up = await uploadReceipt(file, leadId);
        if ("error" in up) return setError(up.error);
        receipt = up.receipt;
      }
      const res = await updateJobExpense(
        expense.id,
        { leadId, vendorId, vendor: vendorText, description, amountCents: cents, spentOn: date },
        receipt
      );
      if (res.error) return setError(res.error);
      await finish();
    } catch {
      setError("Didn't save — check your signal and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete this ${moneyCents(expense.amount_cents)} ${vendorName} bill? It comes off the job's costs, and its receipt is deleted too.`
      )
    )
      return;
    setSaving(true);
    try {
      const res = await deleteJobExpense(expense.id);
      if (res.error) return setError(res.error);
      await finish();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Edit paid bill — ${vendorName}`} onClose={() => { if (!saving) onClose(); }}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="qr-form">
          <Field label="Job">
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              {jobOptions.map((j) => (
                <option key={j.leadId} value={j.leadId}>
                  {j.label}
                </option>
              ))}
            </select>
          </Field>
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
            </select>
          </Field>
          {!vendorId && (
            <Field label="Vendor name">
              <input
                placeholder="e.g. Home Depot"
                value={vendorText}
                onChange={(e) => setVendorText(e.target.value)}
              />
            </Field>
          )}
          <Field label="What for">
            <input
              placeholder={expense.category || "e.g. Drywall + mud"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="qr-pair">
            <Field label="Amount">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date paid">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className={`bill-file-row panel-drop${dragOver ? " drag-over" : ""}`} {...dropProps}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {!file && expense.receipt_url && (
            <ReceiptThumb url={expense.receipt_url} path={expense.receipt_path ?? null} />
          )}
          <button type="button" className="btn-ghost small" onClick={() => fileInput.current?.click()}>
            📷{" "}
            {dragOver
              ? "Drop the receipt"
              : file || expense.receipt_url
                ? "Replace the receipt"
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
                aria-label="Keep the current receipt"
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" className="btn-primary" onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger-ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => void remove()}
          >
            Delete
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}

/** "📎 Attach" on a paid bill saved without its receipt -- click or drop. */
export function AttachExpenseReceipt({
  expense,
  onError,
  onDone,
}: {
  expense: JobExpense;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    onError("");
    try {
      const up = await uploadReceipt(file, expense.lead_id);
      if ("error" in up) return onError(up.error);
      const res = await setJobExpenseReceipt(expense.id, up.receipt);
      if (res.error) return onError(res.error);
      onDone();
    } catch {
      onError("Didn't upload — check your connection and try again.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  const { dragOver, dropProps } = useFileDrop((files) => void upload(files[0]), uploading);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        className={`btn-ghost small${dragOver ? " drop-target-over" : ""}`}
        title="Attach the receipt (photo or PDF) — click or drop it here"
        disabled={uploading}
        onClick={() => input.current?.click()}
        {...dropProps}
      >
        {uploading ? "…" : dragOver ? "Drop it" : "📎 Attach"}
      </button>
    </>
  );
}
