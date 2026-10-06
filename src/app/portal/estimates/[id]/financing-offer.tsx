/**
 * Apply for financing (DECISIONS #161): the lender the company uses, and
 * a button to the lender's own application page. The lender takes the
 * application, decides and sets the terms, so this card names no rate
 * and no payment -- only the lender can state those, with its own
 * disclosures. Not printed with the document.
 */
export function FinancingOffer({
  provider,
  url,
  companyName,
}: {
  provider: string;
  url: string;
  companyName: string;
}) {
  return (
    <div className="portal-card estdoc-sign financing-offer">
      <h2 className="portal-card-title">Want to pay over time?</h2>
      <p className="estdoc-muted">
        {companyName} offers financing through {provider}.
      </p>
      <div className="estdoc-sign-actions">
        <a className="btn-primary" href={url} target="_blank" rel="noopener noreferrer">
          Apply for financing
        </a>
      </div>
      <p className="est-tax-note">
        You&apos;ll apply on {provider}&apos;s website. {provider} decides on your application and
        sets its terms.
      </p>
    </div>
  );
}
