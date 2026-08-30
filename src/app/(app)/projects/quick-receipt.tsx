"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createJobExpense, createReceiptUploadUrl } from "@/lib/actions/job-expenses";
import { getVendors } from "@/lib/actions/vendors";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { centsFromInput, moneyCents, vendorLabel, type Vendor } from "@/lib/data/types";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * The slice of a job the receipt modal needs. Structural on purpose:
 * the full ProjectCard satisfies it, and so does the crew view's card,
 * which never carries money at all.
 */
export type ReceiptJob = {
  leadId: string;
  customer: string;
  address: string | null;
  status: string;
};

/**
 * Receipt capture straight from the projects list -- pick the job, snap
 * the receipt, done. Built for a phone at the supply-house counter: the
 * form stays open after saving so a stack of receipts goes in one after
 * another, and the job and date carry over between them.
 */
export function QuickReceipt({
  projects,
  initialLeadId,
  onClose,
}: {
  projects: ReceiptJob[];
  /** Pre-picked job, when the modal was opened from a specific row. */
  initialLeadId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  // One entry per customer, not per contract: costs hang off the lead,
  // and listing a customer's contract and its change orders separately
  // would just be the same pile twice. A customer running several job
  // sites is labelled by count rather than by whichever site's contract
  // happened to sort first -- that address would be arbitrary.
  const jobs = useMemo(() => {
    const byLead = new Map<string, { leadId: string; customer: string; addresses: Set<string> }>();
    for (const p of projects) {
      if (p.status === "cancelled") continue;
      const entry = byLead.get(p.leadId) ?? {
        leadId: p.leadId,
        customer: p.customer,
        addresses: new Set<string>(),
      };
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
  }, [projects]);

  const [leadId, setLeadId] = useState(
    initialLeadId || (jobs.length === 1 ? jobs[0].leadId : "")
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorText, setVendorText] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getVendors().then((res) => setVendors(res.vendors ?? []));
  }, []);

  async function save() {
    if (!leadId) return setError("Pick the job this receipt belongs to.");
    if (!centsFromInput(amount)) return setError("Enter the amount.");
    setError("");
    setSavedNote("");
    setSaving(true);
    try {
      let uploaded: { path: string; fileName: string; contentType: string | null } | null = null;
      if (file) {
        const shrunk = await downscaleImage(file);
        const signed = await createReceiptUploadUrl(leadId, shrunk.name, shrunk.size);
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

      const res = await createJobExpense(
        {
          leadId,
          estimatePaymentId: null,
          vendorId: vendorId || null,
          vendor: vendorText,
          category: "",
          description,
          amountCents: centsFromInput(amount),
          spentOn,
        },
        uploaded
      );
      if (res.error) return setError(res.error);

      // Job, vendor and date stay -- the next receipt in the stack is
      // usually from the same counter on the same day.
      setAmount("");
      setDescription("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setSavedNote(`Saved ${moneyCents(centsFromInput(amount))} — add the next one or close.`);
      router.refresh();
    } catch {
      // Flaky site cellular is this modal's home turf. Without a catch a
      // rejected fetch just stops the spinner and says nothing.
      setError("Didn't save — check your signal and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // A stray thumb on the backdrop mid-upload must not tear the modal
    // down while the save is in flight.
    <Modal title="Add a receipt" onClose={() => { if (!saving) onClose(); }}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        {/* One stacked column, every field full width and clamped: the
            job option carries a whole street address, and left to size
            itself it forced a second column off-screen and gave the
            modal a sideways scrollbar. */}
        <div className="qr-form">
          <Field label="Job">
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Choose a job…</option>
              {jobs.map((j) => (
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
            <Field label="Date">
              <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Real flex with wrap: .form-row has no stylesheet rule, and a
            long receipt filename is one unbreakable token -- together
            they forced the whole modal into sideways scrolling on a
            phone. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {/* No capture attribute: phones that honor it jump straight
              into the camera with no way back to the file picker, and
              the supplier's emailed PDF is half the point. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => fileInput.current?.click()}
          >
            📷 {file ? "Change receipt" : "Snap or attach the receipt"}
          </button>
          {file && (
            <span className="est-tax-note" style={{ wordBreak: "break-all", minWidth: 0 }}>
              {file.name}
            </span>
          )}
        </div>

        {error && <p className="error-note">{error}</p>}
        {savedNote && !error && <p className="hint-note">{savedNote}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" className="btn-primary" onClick={save}>
            {saving ? "Saving…" : "Save receipt"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}
