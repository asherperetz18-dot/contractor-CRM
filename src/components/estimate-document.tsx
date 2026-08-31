import { Fragment } from "react";
import {
  discountPercentLabel,
  moneyCents,
  paymentPercentOfTotal,
  quantityIsMeaningful,
  depositPayment,
  paymentMethodLabel,
  attachmentIsImage,
  signatureProgress,
  isPricelessKind,
  photosByItem,
  type Estimate,
  type EstimateItem,
  type EstimateSigner,
  type EstimatePayment,
  type EstimateGroup,
  type EstimatePhoto,
  type PortalPayment,
  leadPhotoThumbUrl,
} from "@/lib/data/types";
import { fillContract, lateContractValues, parseContract } from "@/lib/contracts/merge";

export type DocumentCompany = {
  name: string | null;
  dba: string | null;
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

/**
 * Who the customer is dealing with.
 *
 * Names only, deliberately: the company's own phone and email are
 * already in the header, and a rep's direct number is usually their
 * personal mobile -- which should not be published on a document that
 * gets forwarded, printed and kept.
 *
 * The dispatcher is first-name only. They are usually the voice on the
 * phone before anyone visits, so the customer recognises them, but a
 * signed contract does not need an internal coordinator's full name on
 * it.
 */
export type DocumentTeam = {
  repName: string | null;
  dispatcherFirstName: string | null;
};

/**
 * Folds unpriced lines into the priced line they belong to.
 *
 * A line with no amount reads to a homeowner as either an omission or a
 * freebie. Shown instead as "Includes:" beneath the priced work above it,
 * the same scope reads as what it actually is -- covered by that price.
 *
 * A priced line claims every unpriced line that follows it. Unpriced
 * lines appearing before any priced line (site protection listed ahead of
 * the work it protects) attach to the first priced line instead, since
 * they are prep for it. If nothing is priced at all there is nothing to
 * fold into, and every line is left standing on its own.
 */
export function groupIncludedItems(items: EstimateItem[]): {
  parent: EstimateItem;
  included: EstimateItem[];
}[] {
  const priced = (i: EstimateItem) => (i.line_total_cents || 0) > 0;
  if (!items.some(priced)) return items.map((parent) => ({ parent, included: [] }));

  const groups: { parent: EstimateItem; included: EstimateItem[] }[] = [];
  const leading: EstimateItem[] = [];

  for (const item of items) {
    if (priced(item)) {
      groups.push({ parent: item, included: [] });
    } else if (groups.length === 0) {
      leading.push(item);
    } else {
      groups[groups.length - 1].included.push(item);
    }
  }
  if (leading.length) groups[0].included.unshift(...leading);
  return groups;
}

function pct(amountCents: number, totalCents: number): string {
  const p = paymentPercentOfTotal(amountCents, totalCents);
  return p === null ? "—" : `${p.toFixed(2)}%`;
}

/**
 * One attachment on the document: a picture, or a link to a file.
 *
 * A PDF cannot go in an <img> -- it renders as a broken image, and this
 * is the copy the customer reads before signing. Plans and permits are
 * shown as a named link instead, which is also what a printed copy needs:
 * paper cannot open a PDF either, so the name has to be legible on it.
 */
function AttachmentFigure({
  attachment,
}: {
  attachment: { file_url: string; file_name?: string; caption: string | null; content_type: string | null; file_path?: string | null; storage_provider?: string | null };
}) {
  const image = attachmentIsImage(attachment.content_type, attachment.file_name);
  return (
    <figure className={"estdoc-photo" + (image ? "" : " estdoc-attachment")}>
      {image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={leadPhotoThumbUrl(attachment, 1000)} alt={attachment.caption ?? "Job photo"} referrerPolicy="no-referrer" />
      ) : (
        <a href={attachment.file_url} target="_blank" rel="noopener noreferrer">
          <span className="estdoc-attachment-icon" aria-hidden>
            📄
          </span>
          <span className="estdoc-attachment-name">
            {attachment.file_name || "Attachment"}
          </span>
        </a>
      )}
      {attachment.caption && <figcaption>{attachment.caption}</figcaption>}
    </figure>
  );
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
  paid = [],
  photos = [],
  sections = [],
  company,
  customer,
  team,
  parent,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  payments: EstimatePayment[];
  paid?: PortalPayment[];
  /** Attached photos. Nothing on the contact reaches the customer unless
   *  someone put it on this document deliberately. */
  photos?: EstimatePhoto[];
  /** Sections. Empty means the document has none and reads as before. */
  sections?: EstimateGroup[];
  company: DocumentCompany | null;
  customer: DocumentCustomer | null;
  team?: DocumentTeam | null;
  /** The contract this amends, when the document is a change order. */
  parent?: { doc_number: string; total_cents: number; signed_at: string | null } | null;
}) {
  const sig = signatureProgress(signers);
  const isChangeOrder = estimate.kind === "change_order";
  // A completion certificate records acceptance, not a price. Its line
  // items and totals are all zero, and printing "$0.00" beside a document
  // about a $5,400 job invites exactly the wrong conclusion.
  const priceless = isPricelessKind(estimate.kind);

  // Drop the Qty and Price columns entirely when no line has a real
  // measurement: every cell would be blank, and Price would only repeat
  // Amount. A document with one lump-sum line reads as Description and
  // Amount, which is what a homeowner actually wants to see.
  const depositPaid = depositPayment(paid);
  const groups = groupIncludedItems(items);
  // Only the priced parents remain as rows, so the columns are judged on
  // those -- an unpriced "1 ls" that is now folded in must not keep an
  // otherwise empty Qty column alive.
  const showMeasures = groups.some((g) => quantityIsMeaningful(g.parent.quantity, g.parent.unit));
  // Sections, resolved per line. A heading is drawn when a line's section
  // differs from the previous line's, and the subtotal when the next one
  // does -- so an estimate with no sections emits neither and reads
  // exactly as it always has.
  const groupById = new Map(sections.map((g) => [g.id, g]));
  const sectionForItem = (item: EstimateItem) =>
    item.group_id ? (groupById.get(item.group_id) ?? null) : null;
  const endsSection = (i: number) => {
    const mine = sectionForItem(groups[i].parent);
    const next = i + 1 < groups.length ? sectionForItem(groups[i + 1].parent) : null;
    return !!mine && mine.id !== next?.id;
  };
  const sectionTotal = (groupId: string) =>
    items
      .filter((i) => i.group_id === groupId)
      .reduce((sum, i) => sum + (i.line_total_cents || 0), 0);

  const byItem = photosByItem(photos);
  // Photos with no line of their own: site context rather than the
  // justification for one charge.
  const documentPhotos = byItem.get(null) ?? [];
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
          {/* Says what the document is before it says which one. Without
              this a change order reads as a fresh $400 estimate rather
              than an amendment to a $5,400 contract, and the customer
              signing it has no way to tell the difference. */}
          {isChangeOrder && <div className="estdoc-doctype">CHANGE ORDER</div>}
          {priceless && <div className="estdoc-doctype">CERTIFICATE OF COMPLETION</div>}
          <div className="estdoc-docnum">{estimate.doc_number}</div>
          <div className="estdoc-muted">Issued {longDate(estimate.issued_at ?? estimate.created_at)}</div>
          {(isChangeOrder || priceless) && parent && (
            <div className="estdoc-muted">
              To contract {parent.doc_number}
              {parent.signed_at ? `, signed ${longDate(parent.signed_at)}` : ""}
            </div>
          )}
          {estimate.expires_at && estimate.status !== "Signed" && (
            <div className="estdoc-muted">Valid until {longDate(estimate.expires_at)}</div>
          )}
        </div>
      </header>

      {/* Said plainly, at the top, on the customer's own copy. A homeowner
          following an old link should read that it was cancelled and when
          -- not reach a dead page, and not read a live-looking contract
          for work nobody is going to do. */}
      {estimate.status === "Void" && (
        <div className="estdoc-void">
          <strong>This document has been cancelled</strong>
          {estimate.voided_at && <> on {longDate(estimate.voided_at)}</>}. It is no longer an
          offer and nothing on it is owed. Please contact us if you were expecting this work.
        </div>
      )}

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
        {/* Only when it differs from the client's address above --
            repeating the same address twice reads as filler, but a
            contract for an investor's rental must say which property
            the work is for. */}
        {estimate.job_address && (
          <div>
            <div className="estdoc-label">Job location</div>
            <div className="estdoc-strong">{estimate.job_address}</div>
          </div>
        )}
        {/* Who to ask for. A homeowner reading this weeks later should not
            have to work out who they spoke to. Omitted entirely when
            neither is known, rather than printing an empty heading. */}
        {(team?.repName || team?.dispatcherFirstName) && (
          <div>
            <div className="estdoc-label">Your team</div>
            {team.repName && <div className="estdoc-strong">{team.repName}</div>}
            {team.dispatcherFirstName && (
              <div className="estdoc-muted">{team.dispatcherFirstName} · scheduling</div>
            )}
          </div>
        )}
      </section>

      {estimate.customer_message && (
        <p className="estdoc-message">{estimate.customer_message}</p>
      )}

      {/* Both hidden on a certificate: it has no line items and no price,
          and an empty table above a $0.00 total is worse than nothing on a
          document about a finished job. Its wording is the whole content,
          and that renders below with the terms. */}
      {priceless ? null : (
      <table className="estdoc-items">
        <thead>
          <tr>
            <th>Description</th>
            {showMeasures && (
              <>
                <th className="estdoc-num">Qty</th>
                <th className="estdoc-num">Price</th>
              </>
            )}
            <th className="estdoc-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={showMeasures ? 4 : 2} className="estdoc-muted">
                No line items yet.
              </td>
            </tr>
          ) : (
            groups.map(({ parent: item, included }, gi) => {
              // The section heading is emitted before the first line that
              // belongs to it, as a row spanning the table. A separate
              // table per section would break the column widths apart and
              // print as several unrelated grids.
              const section = sectionForItem(item);
              const prevSection = gi > 0 ? sectionForItem(groups[gi - 1].parent) : null;
              const startsSection = !!section && section.id !== prevSection?.id;
              const measured = quantityIsMeaningful(item.quantity, item.unit);
              return (
                <Fragment key={item.id}>
                {startsSection && section && (
                  <tr className="estdoc-section-row">
                    <td colSpan={showMeasures ? 4 : 2}>
                      <div className="estdoc-section-name">{section.name}</div>
                      {section.description && (
                        <div className="estdoc-muted">{section.description}</div>
                      )}
                    </td>
                  </tr>
                )}
                <tr>
                  <td>
                    <div className="estdoc-strong">{item.name}</div>
                    {item.description && <div className="estdoc-muted">{item.description}</div>}
                    {included.length > 0 && (
                      <div className="estdoc-includes">
                        <div className="estdoc-includes-label">Includes</div>
                        {included.map((inc) => (
                          <div key={inc.id} className="estdoc-include">
                            <span className="estdoc-strong">{inc.name}</span>
                            {inc.description && (
                              <span className="estdoc-muted"> — {inc.description}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Directly under the line they pay for. A gallery at
                        the end leaves the customer matching pictures to
                        charges themselves, which is exactly the work the
                        photo was supposed to do for them. */}
                    {(byItem.get(item.id) ?? []).length > 0 && (
                      <div className="estdoc-photos">
                        {(byItem.get(item.id) ?? []).map((p) => (
                          <AttachmentFigure key={p.id} attachment={p} />
                        ))}
                      </div>
                    )}
                  </td>
                  {showMeasures && (
                    <>
                      {/* Blank on a lump-sum line rather than "1 ls", which
                          means nothing to a homeowner, and blank price
                          because it would only repeat the amount. */}
                      <td className="estdoc-num" data-label="Qty">
                        {measured ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : ""}
                      </td>
                      <td className="estdoc-num" data-label="Price">
                        {measured ? moneyCents(item.unit_price_cents) : ""}
                      </td>
                    </>
                  )}
                  {/* Blank, not "$0.00". A zero against a real scope line
                      reads to a homeowner as "this part is worthless",
                      when it usually means it is covered by the priced
                      work above it. */}
                  <td className="estdoc-num" data-label="Amount">
                    {item.line_total_cents ? moneyCents(item.line_total_cents) : ""}
                  </td>
                </tr>
                {/* The subtotal goes after the last line of the section,
                    which is what the customer is looking for when they ask
                    "what is the kitchen costing me". */}
                {section && endsSection(gi) && (
                  <tr className="estdoc-subtotal-row">
                    <td colSpan={showMeasures ? 3 : 1}>{section.name} subtotal</td>
                    <td className="estdoc-num">{moneyCents(sectionTotal(section.id))}</td>
                  </tr>
                )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
      )}

      {documentPhotos.length > 0 && (
        <section className="estdoc-photo-section">
          <h2 className="estdoc-h2">Photos</h2>
          <div className="estdoc-photos">
            {documentPhotos.map((p) => (
              <AttachmentFigure key={p.id} attachment={p} />
            ))}
          </div>
        </section>
      )}

      {priceless ? null : (
      <div className="estdoc-totals">
        <div className="estdoc-total-row">
          <span>Subtotal</span>
          <span>{moneyCents(estimate.subtotal_cents)}</span>
        </div>
        {(estimate.discount_cents ?? 0) > 0 && (
          <div className="estdoc-total-row estdoc-discount">
            <span>
              {estimate.discount_label || "Discount"}
              {estimate.discount_type === "percent" &&
                ` (${discountPercentLabel(estimate.discount_value)})`}
            </span>
            <span>−{moneyCents(estimate.discount_cents)}</span>
          </div>
        )}
        {estimate.tax_cents > 0 && (
          <div className="estdoc-total-row">
            <span>Sales tax</span>
            <span>{moneyCents(estimate.tax_cents)}</span>
          </div>
        )}
        <div className="estdoc-total-row estdoc-grand">
          <span>{isChangeOrder ? "This change order" : "Total"}</span>
          <span>{moneyCents(estimate.total_cents)}</span>
        </div>
        {/* What the contract becomes. A customer asked to approve $400
            needs to see the number it lands on, not work it out -- and a
            credit reads as a reduction only when the new total is shown
            beside it. */}
        {(isChangeOrder || priceless) && parent && (
          <>
            <div className="estdoc-total-row">
              <span>Original contract {parent.doc_number}</span>
              <span>{moneyCents(parent.total_cents)}</span>
            </div>
            <div className="estdoc-total-row estdoc-grand">
              <span>Revised contract total</span>
              <span>{moneyCents(parent.total_cents + estimate.total_cents)}</span>
            </div>
          </>
        )}
      </div>
      )}

      {/* The payment schedule is the part a homeowner reads hardest -- it
          is what they are committing to pay and when. Percentages are of
          the contract total, matching what the rep saw when building it. */}
      {/* Never on a change order. Its amount is added as one phase to the
          contract's existing schedule, so printing a second schedule here
          would offer the customer payment terms that do not govern
          anything -- two schedules for one job, disagreeing. */}
      {!isChangeOrder && (estimate.deposit_cents || payments.length > 0) && (
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
                  <td className="estdoc-num" data-label="Of total">
                    {pct(estimate.deposit_cents, estimate.total_cents)}
                  </td>
                  <td className="estdoc-num" data-label="Amount">
                    {moneyCents(estimate.deposit_cents)}
                    {/* A receipt on the contract itself: the homeowner can
                        see what they have already paid without digging out
                        a card statement. */}
                    {depositPaid && (
                      <div className="estdoc-paid">
                        PAID
                        {depositPaid.paid_at
                          ? " " + new Date(depositPaid.paid_at).toLocaleDateString("en-US")
                          : ""}
                        {paymentMethodLabel(depositPaid.method)
                          ? " · " + paymentMethodLabel(depositPaid.method)
                          : ""}
                      </div>
                    )}
                  </td>
                </tr>
              ) : null}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="estdoc-strong">{p.name}</div>
                    {p.description && <div className="estdoc-muted">{p.description}</div>}
                  </td>
                  <td className="estdoc-num" data-label="Of total">
                    {pct(p.amount_cents, estimate.total_cents)}
                  </td>
                  <td className="estdoc-num" data-label="Amount">
                    {moneyCents(p.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {estimate.terms && (
        <section className="estdoc-terms">
          <div className="estdoc-label">Terms</div>
          {/* Rendered as blocks, not one paragraph. This carries a full
              home-improvement contract now -- sixteen numbered sections,
              a mechanics lien warning and a right-to-cancel notice -- and
              a wall of text is not a document somebody reads before
              signing. Nothing here interprets HTML: the body is plain
              text an office user pasted in, and it renders as text. */}
          {/* Filled again on the way out. Sending freezes these into the
              stored text, but before that a draft still carries
              {{contract_total}} -- and showing braces to whoever is
              checking the document over is how a contract goes out with
              them still in it. Same function both times, so the preview
              cannot disagree with what gets sent. */}
          {parseContract(fillContract(estimate.terms, lateContractValues(estimate))).map((block, i) =>
            block.kind === "heading" ? (
              <h4 key={i} className="estdoc-terms-head">
                {block.text}
              </h4>
            ) : block.kind === "bullet" ? (
              <ul key={i} className="estdoc-terms-list">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{block.text}</p>
            )
          )}
        </section>
      )}

      {/* Outstanding items, between the wording and the signature.
          Clause 2 of the certificate promises that anything listed stays
          the contractor's responsibility and is not waived by signing --
          a promise only kept if the items are on the document that was
          signed, rather than filed somewhere off to the side. Rendered
          from the columns rather than frozen into the body text, so the
          customer's own list (written at the moment they sign, long
          after the wording was composed) appears here too. */}
      {priceless && (
        <section className="estdoc-terms estdoc-punch">
          <h4 className="estdoc-terms-head">Outstanding items</h4>
          {estimate.completion_notes?.trim() ? (
            <ul className="estdoc-terms-list">
              {estimate.completion_notes
                .split("\n")
                .map((l) => l.replace(/^[-•*]\s*/, "").trim())
                .filter(Boolean)
                .map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
            </ul>
          ) : (
            <p>None recorded by the contractor.</p>
          )}

          <h4 className="estdoc-terms-head">Raised by the owner on signing</h4>
          {estimate.completion_customer_items?.trim() ? (
            <ul className="estdoc-terms-list">
              {estimate.completion_customer_items
                .split("\n")
                .map((l) => l.replace(/^[-•*]\s*/, "").trim())
                .filter(Boolean)
                .map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
            </ul>
          ) : (
            <p>
              {estimate.status === "Signed"
                ? "None. The Owner accepted the work without raising any items."
                : "To be completed by the Owner when signing."}
            </p>
          )}
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
                  {s.signature_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.signature_image}
                      alt={`${s.signature_name ?? s.name}'s signature`}
                      className="estdoc-signature-img"
                    />
                  ) : s.signature_name ? (
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
