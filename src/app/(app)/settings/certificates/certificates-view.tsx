"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteCompanyDocument,
  getCompanyDocuments,
  setCompanyDocumentVisible,
  uploadCompanyDocument,
  type CompanyDocument,
} from "@/lib/actions/company-documents";
import {
  COMPANY_DOC_KINDS,
  docKindLabel,
  expiringSoon,
  isExpired,
} from "@/lib/data/company-docs";

function fileSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function CertificatesView() {
  const [docs, setDocs] = useState<CompanyDocument[] | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCompanyDocuments();
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setDocs(res.documents ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      const res = await uploadCompanyDocument(form);
      if (res.error) return setError(res.error);
      formRef.current?.reset();
      setReloadKey((k) => k + 1);
    });
  }

  if (error && !docs) return <p className="error-note">{error}</p>;
  if (!docs) return <p className="empty-hint">Loading…</p>;

  const expired = docs.filter((d) => isExpired(d.expires_on));
  const soon = docs.filter((d) => expiringSoon(d.expires_on));

  return (
    <div>
      {expired.length > 0 && (
        <p className="error-note">
          {expired.length === 1 ? "1 certificate has" : `${expired.length} certificates have`}{" "}
          expired and {expired.length === 1 ? "is" : "are"} no longer shown to customers.
          Upload the renewal.
        </p>
      )}
      {soon.length > 0 && (
        <p className="hint-note">
          {soon.length === 1 ? "1 certificate expires" : `${soon.length} certificates expire`}{" "}
          within 30 days.
        </p>
      )}

      <form ref={formRef} onSubmit={submit} className="ta-panel" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Type *</span>
            <select name="kind" defaultValue="license" disabled={pending}>
              {COMPANY_DOC_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Name *</span>
            <input name="title" placeholder="e.g. CSLB Licence 1027193" disabled={pending} />
          </label>
          <label className="field">
            <span className="field-label">Expires</span>
            <input type="date" name="expires_on" disabled={pending} />
          </label>
          <label className="field">
            <span className="field-label">File * (PDF or image, up to 15MB)</span>
            <input type="file" name="file" accept="application/pdf,image/*" disabled={pending} />
          </label>
        </div>
        <label className="est-record-check">
          <input type="checkbox" name="show_on_portal" defaultChecked disabled={pending} />
          <span>
            Show on the customer portal{" "}
            <span className="est-tax-note">
              — an expired certificate is hidden automatically whatever this says
            </span>
          </span>
        </label>
        {error && <p className="error-note">{error}</p>}
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <div />
          <button className="btn-primary" type="submit" disabled={pending}>
            {pending ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>

      {docs.length === 0 ? (
        <p className="empty-hint">
          Nothing uploaded yet. Your licence and a current insurance certificate are what
          most customers ask for before work starts.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Type</th>
              <th>Expires</th>
              <th>On portal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const gone = isExpired(d.expires_on);
              return (
                <tr key={d.id} className={gone ? "rv-cell-dirty" : ""}>
                  <td>
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer">
                      {d.title}
                    </a>
                    <div className="est-tax-note">
                      {d.file_name} {fileSize(d.file_size)}
                    </div>
                  </td>
                  <td>{docKindLabel(d.kind)}</td>
                  <td>
                    {d.expires_on
                      ? new Date(`${d.expires_on}T00:00:00`).toLocaleDateString("en-US")
                      : "—"}
                    {gone && <span className="est-tax-note"> · expired</span>}
                    {expiringSoon(d.expires_on) && (
                      <span className="est-tax-note"> · expiring</span>
                    )}
                  </td>
                  <td>
                    {gone ? (
                      <span className="est-tax-note">hidden — expired</span>
                    ) : (
                      <label className="est-record-check">
                        <input
                          type="checkbox"
                          checked={d.show_on_portal}
                          disabled={pending}
                          onChange={(e) =>
                            startTransition(async () => {
                              const res = await setCompanyDocumentVisible(d.id, e.target.checked);
                              if (res.error) return setError(res.error);
                              setReloadKey((k) => k + 1);
                            })
                          }
                        />
                        <span className="est-tax-note">{d.show_on_portal ? "shown" : "hidden"}</span>
                      </label>
                    )}
                  </td>
                  <td className="right">
                    <button
                      className="btn-ghost small"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Delete "${d.title}"? The file is removed too.`)) {
                          startTransition(async () => {
                            const res = await deleteCompanyDocument(d.id);
                            if (res.error) return setError(res.error);
                            setReloadKey((k) => k + 1);
                          });
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
