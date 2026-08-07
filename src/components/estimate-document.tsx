import {
  moneyCents,
  paymentPercentOfTotal,
  signatureProgress,
  type Estimate,
  type EstimateItem,
  type EstimateSigner,
  type EstimatePayment,
} from "@/lib/data/types";

export type DocumentCompany = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  license_number: string | null;
  license_state: string | null;
  license_type: string | null;
};

export type DocumentCustomer = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

function pct(amountCents: number, totalCents: number): string {
  const p = paymentPercentOfTotal(amountCents, totalCents);
  return p === null ? "—" : `${p.toFixed(2)}%`;
}

function longDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The customer-facing document. Rendered both in the client portal and in
 * the staff "Preview as Customer" view from the same component, so what
 * the rep checks before sending is literally what the homeowner opens --
 * two templates would drift and the rep would be proofreading the wrong
 * one.
 *
 * Presentational only: it never reads cost_cents, so internal margin
 * cannot leak onto a page a customer can see.
 */
export function EstimateDocument({
  estimate,
  items,
  signers,
  payments,
  company,
  customer,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  payments: EstimatePayment[];
  company: DocumentCompany | null;
  customer: DocumentCustomer | null;
}) {
  const sig = signatureProgress(signers);
  const customerName =
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || "Customer";

  // CSLB requires the licence number on California home-improvement
  // contracts, and a signed estimate becomes one.
  const licence = [company?.license_type, company?.license_number].filter(Boolean).join(" ");

  return (
    <article className="estdoc">
      <header className="estdoc-head">
        <div className="estdoc-company">
          {company?.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={company.logo_url} alt="" className="estdoc-logo" />
          )}
          <div>
            <h1 className="estdoc-company-name">{company?.name || "Estimate"}</h1>
            {company?.address && <div className="estdoc-muted">{company.address}</div>}
            <div className="estdoc-muted">
              {[company?.phone, company?.email, company?.website].filter(Boolean).join(" · ")}
            </div>
            {licence && (
              <div className="estdoc-muted">
                Lic. {licence}
                {company?.license_state ? ` (${company.license_state})` : ""}
              </div>
            )}
          </div>
        </div>
        <div className="estdoc-meta">
          <div className="estdoc-docnum">{estimate.doc_number}</div>
          <div className="estdoc-muted">Issued {longDate(estimate.issued_at ?? estimate.created_at)}</div>
          {estimate.expires_at && estimate.status !== "Signed" && (
            <div className="estdoc-muted">Valid until {longDate(estimate.expires_at)}</div>
          )}
        </div>
      </header>

      <section className="estdoc-parties">
        <div>
          <div className="estdoc-label">Prepared for</div>
          <div className="estdoc-strong">{customerName}</div>
          {customer?.address && <div className="estdoc-muted">{customer.address}</div>}
          <div className="estdoc-muted">
            {[customer?.phone, customer?.email].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div>
          <div className="estdoc-label">Project</div>
          <div className="estdoc-strong">{estimate.title || "Estimate"}</div>
        </div>
      </section>

      {estimate.customer_message && (
        <p className="estdoc-message">{estimate.customer_message}</p>
      )}

      <table className="estdoc-items">
        <thead>
          <tr>
            <th>Description</th>
            <th className="estdoc-num">Qty</th>
            <th className="estdoc-num">Price</th>
            <th className="estdoc-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="estdoc-muted">
                No line items yet.
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="estdoc-strong">{item.name}</div>
                  {item.description && <div className="estdoc-muted">{item.description}</div>}
                </td>
                <td className="estdoc-num">
                  {item.quantity}
                  {item.unit ? ` ${item.unit}` : ""}
                </td>
                <td className="estdoc-num">{moneyCents(item.unit_price_cents)}</td>
                <td className="estdoc-num">{moneyCents(item.line_total_cents)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="estdoc-totals">
        <div className="estdoc-total-row">
          <span>Subtotal</span>
          <span>{moneyCents(estimate.subtotal_cents)}</span>
        </div>
        {estimate.tax_cents > 0 && (
          <div className="estdoc-total-row">
            <span>Sales tax</span>
            <span>{moneyCents(estimate.tax_cents)}</span>
          </div>
        )}
        <div className="estdoc-total-row estdoc-grand">
          <span>Total</span>
          <span>{moneyCents(estimate.total_cents)}</span>
        </div>
      </div>

      {/* The payment schedule is the part a homeowner reads hardest -- it
          is what they are committing to pay and when. Percentages are of
          the contract total, matching what the rep saw when building it. */}
      {(estimate.deposit_cents || payments.length > 0) && (
        <section className="estdoc-schedule">
          <div className="estdoc-label">Payment schedule</div>
          <table className="estdoc-items estdoc-schedule-table">
            <tbody>
              {estimate.deposit_cents ? (
                <tr>
                  <td>
                    <div className="estdoc-strong">Deposit</div>
                    <div className="estdoc-muted">Due upon contract signing</div>
                  </td>
                  <td className="estdoc-num">
                    {pct(estimate.deposit_cents, estimate.total_cents)}
                  </td>
                  <td className="estdoc-num">{moneyCents(estimate.deposit_cents)}</td>
                </tr>
              ) : null}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="estdoc-strong">{p.name}</div>
                    {p.description && <div className="estdoc-muted">{p.description}</div>}
                  </td>
                  <td className="estdoc-num">{pct(p.amount_cents, estimate.total_cents)}</td>
                  <td className="estdoc-num">{moneyCents(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {estimate.terms && (
        <section className="estdoc-terms">
          <div className="estdoc-label">Terms</div>
          <p>{estimate.terms}</p>
        </section>
      )}

      {signers.length > 0 && (
        <section className="estdoc-signatures">
          <div className="estdoc-label">
            Signatures ({sig.signed} of {sig.total})
          </div>
          <div className="estdoc-signer-grid">
            {signers.map((s) => (
              <div key={s.id} className="estdoc-signer">
                <div className="estdoc-signer-line">
                  {s.signature_name ? (
                    <span className="estdoc-signed-name">{s.signature_name}</span>
                  ) : (
                    <span className="estdoc-unsigned">Awaiting signature</span>
                  )}
                </div>
                <div className="estdoc-strong">{s.name}</div>
                <div className="estdoc-muted">
                  {s.party === "company" ? "Contractor" : "Customer"}
                  {s.signed_at
                    ? ` · signed ${new Date(s.signed_at).toLocaleDateString("en-US")}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
