import { moneyCents } from "@/lib/data/types";
import { balanceWords, statementAmount, type CustomerStatement } from "@/lib/data/customer-statement";

export type StatementCompany = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The statement itself, as printed (DECISIONS #153). */
export function StatementDocument({
  company,
  customer,
  address,
  today,
  statement,
}: {
  company: StatementCompany | null;
  customer: string;
  address: string | null;
  /** The company's YYYY-MM-DD. */
  today: string;
  statement: CustomerStatement;
}) {
  const credit = statement.balanceCents < 0;
  return (
    <div className="estdoc-preview-frame">
      <div className="estdoc">
        <header className="estdoc-head">
          <div className="estdoc-company">
            {company?.logo_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={company.logo_url} alt="" className="estdoc-logo" />
            )}
            <div>
              <h1 className="estdoc-company-name">{company?.name || "Statement"}</h1>
              {company?.address && <div className="estdoc-muted">{company.address}</div>}
              <div className="estdoc-muted">{[company?.phone, company?.email].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <div className="estdoc-meta">
            <div className="estdoc-doctype">STATEMENT</div>
            <div className="estdoc-muted">As of {longDay(today)}</div>
          </div>
        </header>

        <div className="estdoc-parties">
          <div>
            <div className="estdoc-label">Customer</div>
            <div className="estdoc-strong">{customer}</div>
            {address && <div className="estdoc-muted">{address}</div>}
          </div>
          <div>
            <div className="estdoc-label">{credit ? "Credit" : "Balance due"}</div>
            <div className="estdoc-strong mono">{moneyCents(Math.abs(statement.balanceCents))}</div>
            {statement.overdueCents > 0 && (
              <div className="estdoc-muted">{moneyCents(statement.overdueCents)} past due</div>
            )}
          </div>
        </div>

        {statement.lines.length === 0 ? (
          <p className="estdoc-muted">Nothing has been billed to {customer} yet.</p>
        ) : (
          <table className="estdoc-items estdoc-schedule-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="estdoc-num">Amount</th>
                <th className="estdoc-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l, i) => (
                <tr key={`${l.docId}-${i}`}>
                  <td>{shortDay(l.day)}</td>
                  <td>
                    <strong>{l.label}</strong>
                    {l.detail && <div className="estdoc-muted">{l.detail}</div>}
                  </td>
                  <td className="estdoc-num">{statementAmount(l)}</td>
                  <td className="estdoc-num">{moneyCents(l.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  Billed {moneyCents(statement.billedCents)} · Paid {moneyCents(statement.paidCents)}
                </td>
                <td className="estdoc-num" colSpan={2}>
                  <strong>{balanceWords(statement.balanceCents)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {statement.clearing.cents > 0 && (
          <p className="estdoc-muted">
            Payments on their way: {moneyCents(statement.clearing.cents)}, not counted until they
            arrive.
          </p>
        )}
        <p className="estdoc-muted">
          Questions about this statement? Contact {company?.name || "us"}
          {company?.phone ? ` at ${company.phone}` : ""}
          {company?.email ? `${company?.phone ? " or" : " at"} ${company.email}` : ""}.
        </p>
      </div>
    </div>
  );
}
