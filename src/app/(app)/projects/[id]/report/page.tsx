import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canViewEstimates,
  computeProjectRollup,
  billRemainingCents,
  moneyCents,
  paidTotalCents,
  type Estimate,
  type EstimatePayment,
  type JobExpense,
  type PortalPayment,
} from "@/lib/data/types";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

type Company = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

type ReportLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
};

type ChecklistRow = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  note?: string | null;
};

function longDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * One job on paper.
 *
 * Two audiences, one page. The internal copy is the whole job: documents,
 * billing, payments, costs, steps and net cash. The client copy
 * (?view=client) drops every section a customer has no business seeing --
 * costs, net cash and the office's step list -- and the sections are
 * *not fetched shown-but-hidden*: what the client copy omits it simply
 * never renders, so it cannot leak through a print dialog's "print
 * hidden elements" or a saved page source.
 */
export default async function ProjectReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewEstimates(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to this report</p>
        <p className="empty-hint">
          The project report shows contract totals. Ask an Office or Admin user to switch
          on View Estimates for you in Admin Settings &rarr; Users &amp; Roles.
        </p>
      </div>
    );
  }

  const { id } = await params;
  const sp = await searchParams;
  const clientView = sp.view === "client";
  const supabase = await createClient();
  const companyId = profile.company_id;

  const { data: contract } = await supabase
    .from("estimates")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle<Estimate>();

  // A project is a signed contract (a voided-after-signing one is a
  // cancelled project). Anything else -- a draft, a change order id, a
  // stranger's id RLS already hid -- has no project report.
  const isProject =
    contract &&
    (contract.kind ?? "contract") === "contract" &&
    (contract.status === "Signed" || (contract.status === "Void" && contract.signed_at));
  if (!contract || !isProject) {
    return (
      <div className="empty-state">
        <p className="empty-label">No project here</p>
        <p className="empty-hint">
          A project report belongs to a signed contract.{" "}
          <Link href="/projects">Back to projects</Link>
        </p>
      </div>
    );
  }

  const [
    { data: changeOrdersRaw },
    { data: leadContracts },
    { data: lead },
    { data: company },
    { data: checklistRows },
  ] = await Promise.all([
    supabase
      .from("estimates")
      .select("*")
      .eq("company_id", companyId)
      .eq("parent_estimate_id", contract.id)
      .order("created_at", { ascending: true }),
    // Every signed contract this customer has, cancelled ones included --
    // the same population the Projects page counts when deciding whether
    // unfiled costs can be pinned on this job.
    supabase
      .from("estimates")
      .select("id, kind, status, signed_at")
      .eq("company_id", companyId)
      .eq("lead_id", contract.lead_id),
    supabase
      .from("leads")
      .select("id, first_name, last_name, company_name, address, phone, email, assigned_to")
      .eq("id", contract.lead_id)
      .maybeSingle<ReportLead>(),
    supabase
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", companyId)
      .maybeSingle<Company>(),
    supabase
      .from("project_checklist_items")
      .select("*")
      .eq("estimate_id", contract.id)
      .order("sort_order", { ascending: true }),
  ]);

  const changeOrders = (changeOrdersRaw as Estimate[] | null) ?? [];
  const docIds = [contract.id, ...changeOrders.map((e) => e.id)];
  const docOrder = new Map(docIds.map((d, i) => [d, i]));

  const [
    { data: phasesRaw },
    { data: paidRaw },
    { data: expensesRaw },
    { data: billsRaw },
    { data: billPaymentsRaw },
    { data: repProfile },
  ] = await Promise.all([
    supabase
      .from("estimate_payments")
      .select("id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date")
      .in("estimate_id", docIds),
    supabase
      .from("portal_payments")
      .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at")
      .in("estimate_id", docIds),
    supabase
      .from("job_expenses")
      .select("id, company_id, lead_id, estimate_payment_id, vendor, category, description, amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at")
      .eq("lead_id", contract.lead_id),
    supabase
      .from("vendor_bills")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_id", contract.lead_id)
      .is("voided_at", null),
    supabase
      .from("vendor_bill_payments")
      .select("bill_id, amount_cents")
      .eq("company_id", companyId),
    lead?.assigned_to
      ? supabase.from("profiles").select("name").eq("id", lead.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const phases = ((phasesRaw as EstimatePayment[] | null) ?? []).sort(
    (a, b) =>
      (docOrder.get(a.estimate_id) ?? 0) - (docOrder.get(b.estimate_id) ?? 0) ||
      a.sort_order - b.sort_order
  );
  const paid = (paidRaw as PortalPayment[] | null) ?? [];
  const leadExpenses = (expensesRaw as JobExpense[] | null) ?? [];

  const signedChangeOrders = changeOrders.filter((e) => e.status === "Signed");
  const ownPhaseIds = new Set(phases.map((p) => p.id));

  // Same ownership rules as the Projects page. An expense filed to a
  // phase of a DIFFERENT contract is that job's, not this one's; one
  // filed to a phase that no longer exists anywhere is unfiled again.
  const strayPhaseIds = [
    ...new Set(
      leadExpenses
        .map((e) => e.estimate_payment_id)
        .filter((pid): pid is string => !!pid && !ownPhaseIds.has(pid))
    ),
  ];
  const { data: strayPhases } = strayPhaseIds.length
    ? await supabase.from("estimate_payments").select("id").in("id", strayPhaseIds)
    : { data: [] as { id: string }[] };
  const phaseExists = new Set([...ownPhaseIds, ...(strayPhases ?? []).map((p) => p.id)]);

  const filedExpenses = leadExpenses.filter(
    (e) => e.estimate_payment_id && ownPhaseIds.has(e.estimate_payment_id)
  );
  const unfiledExpenses = leadExpenses.filter(
    (e) => !e.estimate_payment_id || !phaseExists.has(e.estimate_payment_id)
  );

  const signedContractsForLead = ((leadContracts as Pick<Estimate, "id" | "kind" | "status" | "signed_at">[] | null) ?? []).filter(
    (e) =>
      (e.kind ?? "contract") === "contract" &&
      (e.status === "Signed" || (e.status === "Void" && e.signed_at))
  ).length;
  const soleContract = signedContractsForLead <= 1;

  const rollup = computeProjectRollup({
    contractTotalCents: contract.total_cents,
    signedChangeOrderCents: signedChangeOrders.reduce((s, e) => s + e.total_cents, 0),
    payments: paid,
    billedCents: phases.filter((p) => p.requested_at).reduce((s, p) => s + p.amount_cents, 0),
    filedCostCents: filedExpenses.reduce((s, e) => s + e.amount_cents, 0),
    unfiledCostCents: unfiledExpenses.reduce((s, e) => s + e.amount_cents, 0),
    ownsUnfiledCosts: soleContract,
  });

  // The costs this report may honestly list: filed ones always, unfiled
  // ones only when this is the customer's one contract.
  const shownExpenses = [...filedExpenses, ...(soleContract ? unfiledExpenses : [])].sort(
    (a, b) => (a.spent_on ?? a.created_at).localeCompare(b.spent_on ?? b.created_at)
  );

  const paymentsByBill = new Map<string, { amount_cents: number }[]>();
  for (const p of (billPaymentsRaw as { bill_id: string; amount_cents: number }[] | null) ?? []) {
    const list = paymentsByBill.get(p.bill_id) ?? [];
    list.push(p);
    paymentsByBill.set(p.bill_id, list);
  }
  const unpaidBillsCents = (
    (billsRaw as { id: string; amount_cents: number; estimate_payment_id?: string | null }[] | null) ?? []
  )
    .map((b) => ({ ...b, remaining: billRemainingCents(b, paymentsByBill.get(b.id) ?? []) }))
    .filter(
      (b) =>
        b.remaining > 0 &&
        (b.estimate_payment_id ? ownPhaseIds.has(b.estimate_payment_id) : soleContract)
    )
    .reduce((s, b) => s + b.remaining, 0);

  const settled = paid
    .filter((p) => p.status === "succeeded")
    .sort((a, b) => (a.paid_at ?? a.created_at).localeCompare(b.paid_at ?? b.created_at));
  const pending = paid.filter((p) => p.status === "pending");

  const completionSigned = changeOrders.some(
    (e) => (e.kind ?? "") === "completion" && e.status === "Signed"
  );
  const statusLabel =
    contract.status === "Void"
      ? "Cancelled"
      : (contract as { project_on_hold?: boolean }).project_on_hold
        ? "On hold"
        : completionSigned || contract.completed_on
          ? "Complete"
          : "In progress";

  const customer =
    lead?.company_name ||
    [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") ||
    "Unnamed customer";
  const jobAddress = contract.job_address ?? lead?.address ?? null;
  const repName = (repProfile as { name: string | null } | null)?.name ?? null;
  const items = (checklistRows as ChecklistRow[] | null) ?? [];
  const todayISO = new Date().toISOString().slice(0, 10);

  // Documents the sheet lists: the contract, then every non-void child.
  const docs = [contract, ...changeOrders.filter((e) => e.status !== "Void")];

  const base = `/projects/${contract.id}/report`;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Project report</h1>
          <p className="module-sub">
            {contract.doc_number} · {customer}
            {clientView
              ? " — client copy, no costs on it"
              : " — internal copy with costs; switch to the client copy before handing it over"}
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/projects" className="btn-ghost">
            Back to projects
          </Link>
          <Link className={"chip" + (!clientView ? " chip-sel" : "")} href={base}>
            Internal
          </Link>
          <Link className={"chip" + (clientView ? " chip-sel" : "")} href={`${base}?view=client`}>
            Client copy
          </Link>
          <PrintButton
            label="Print / Save as PDF"
            title={`${contract.doc_number} ${clientView ? "client report" : "report"}`}
          />
        </div>
      </div>

      <div className="estdoc-preview-frame">
        <div className="estdoc">
          <header className="estdoc-head">
            <div className="estdoc-company">
              {company?.logo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={company.logo_url} alt="" className="estdoc-logo" />
              )}
              <div>
                <h1 className="estdoc-company-name">{company?.name || "Project report"}</h1>
                {company?.address && <div className="estdoc-muted">{company.address}</div>}
                <div className="estdoc-muted">
                  {[company?.phone, company?.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div className="estdoc-meta">
              <div className="estdoc-doctype">PROJECT REPORT</div>
              <div className="estdoc-muted">{contract.doc_number}</div>
              <div className="estdoc-muted">Prepared {longDate(todayISO)}</div>
              <div className="estdoc-muted">
                {clientView ? "Client copy" : "Internal — includes costs"}
              </div>
            </div>
          </header>

          <div className="estdoc-parties">
            <div>
              <div className="estdoc-label">Customer</div>
              <div className="estdoc-strong">{customer}</div>
              {lead?.address && <div className="estdoc-muted">{lead.address}</div>}
              <div className="estdoc-muted">
                {[lead?.phone, lead?.email].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div>
              <div className="estdoc-label">Job</div>
              <div className="estdoc-strong">{contract.title || "Untitled job"}</div>
              {jobAddress && jobAddress !== lead?.address && (
                <div className="estdoc-muted">{jobAddress}</div>
              )}
              <div className="estdoc-muted">
                {[
                  statusLabel,
                  contract.signed_at && `Signed ${shortDate(contract.signed_at)}`,
                  contract.start_date && `Starts ${shortDate(contract.start_date)}`,
                  contract.completion_date && `Due ${shortDate(contract.completion_date)}`,
                  repName && `Rep: ${repName}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>

          <h2 className="estdoc-terms-head">Contract &amp; change orders</h2>
          <table className="estdoc-items estdoc-schedule-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Title</th>
                <th>Status</th>
                <th>Signed</th>
                <th className="estdoc-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.doc_number}</strong>
                    {d.id !== contract.id && (
                      <div className="estdoc-muted">
                        {(d.kind ?? "") === "completion" ? "Completion certificate" : "Change order"}
                      </div>
                    )}
                  </td>
                  <td>{d.title || "—"}</td>
                  <td>
                    {d.id === contract.id && contract.status === "Void"
                      ? "Cancelled"
                      : d.status}
                  </td>
                  <td className="estdoc-muted">{shortDate(d.signed_at)}</td>
                  <td className="estdoc-num mono">
                    {(d.kind ?? "") === "completion" ? "—" : moneyCents(d.total_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="estdoc-totals">
            <div className="estdoc-total-row estdoc-grand">
              <span>Total (contract + signed change orders)</span>
              <span className="mono">{moneyCents(rollup.soldCents)}</span>
            </div>
          </div>

          {phases.length > 0 && (
            <>
              <h2 className="estdoc-terms-head">Payment schedule</h2>
              <table className="estdoc-items estdoc-schedule-table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th className="estdoc-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((ph) => {
                    const paidForPhase = paidTotalCents(
                      settled.filter((p) => p.estimate_payment_id === ph.id)
                    );
                    return (
                      <tr key={ph.id}>
                        <td>
                          <strong>{ph.name}</strong>
                          {ph.description && (
                            <div className="estdoc-muted">{ph.description}</div>
                          )}
                        </td>
                        <td className="estdoc-muted">{shortDate(ph.due_date)}</td>
                        <td>
                          {ph.amount_cents > 0 && paidForPhase >= ph.amount_cents ? (
                            "Paid"
                          ) : paidForPhase > 0 ? (
                            `Partly paid (${moneyCents(paidForPhase)})`
                          ) : ph.requested_at ? (
                            `Billed ${shortDate(ph.requested_at)}`
                          ) : (
                            <span className="estdoc-muted">Not yet billed</span>
                          )}
                        </td>
                        <td className="estdoc-num mono">{moneyCents(ph.amount_cents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          <h2 className="estdoc-terms-head">Payments received</h2>
          {settled.length === 0 ? (
            <p className="estdoc-muted">Nothing collected yet.</p>
          ) : (
            <table className="estdoc-items estdoc-schedule-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th className="estdoc-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((p) => (
                  <tr key={p.id}>
                    <td>{shortDate(p.paid_at ?? p.created_at)}</td>
                    <td>{p.kind === "deposit" ? "Deposit" : "Progress payment"}</td>
                    <td className="estdoc-muted">{p.method || "—"}</td>
                    <td className="estdoc-num mono">{moneyCents(p.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pending.length > 0 && (
            <p className="estdoc-muted">
              {pending.length} payment{pending.length === 1 ? "" : "s"} totalling{" "}
              {moneyCents(pending.reduce((s, p) => s + p.amount_cents, 0))}{" "}
              {pending.length === 1 ? "is" : "are"} still settling and not counted above.
            </p>
          )}

          {!clientView && shownExpenses.length > 0 && (
            <>
              <h2 className="estdoc-terms-head">Job costs</h2>
              <table className="estdoc-items estdoc-schedule-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th className="estdoc-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {shownExpenses.map((e) => (
                    <tr key={e.id}>
                      <td>{shortDate(e.spent_on ?? e.created_at)}</td>
                      <td>{e.vendor || "—"}</td>
                      <td className="estdoc-muted">{e.category || "—"}</td>
                      <td className="estdoc-muted">{e.description || "—"}</td>
                      <td className="estdoc-num mono">{moneyCents(e.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {!clientView && !soleContract && unfiledExpenses.length > 0 && (
            <p className="estdoc-muted">
              {moneyCents(unfiledExpenses.reduce((s, e) => s + e.amount_cents, 0))} of this
              customer&apos;s costs are not filed to any phase, and the customer has more than
              one signed contract — so they are not counted against this job or listed above.
              File them to a phase on the right contract and they will land.
            </p>
          )}

          <h2 className="estdoc-terms-head">Money summary</h2>
          <div className="estdoc-totals">
            <div className="estdoc-total-row">
              <span>{clientView ? "Contract total (with signed change orders)" : "Sold"}</span>
              <span className="mono">{moneyCents(rollup.soldCents)}</span>
            </div>
            <div className="estdoc-total-row">
              <span>
                {clientView ? "Paid to date" : "Collected"}
                {rollup.collectedPct !== null &&
                  ` (${rollup.collectedPct.toFixed(0)}% of total)`}
              </span>
              <span className="mono">{moneyCents(rollup.collectedCents)}</span>
            </div>
            {clientView ? (
              <div className="estdoc-total-row estdoc-grand">
                <span>Remaining on contract</span>
                <span className="mono">
                  {moneyCents(Math.max(0, rollup.soldCents - rollup.collectedCents))}
                </span>
              </div>
            ) : (
              <>
                <div className="estdoc-total-row">
                  <span>Owed to you (billed, not yet paid)</span>
                  <span className="mono">{moneyCents(rollup.receivableCents)}</span>
                </div>
                <div className="estdoc-total-row">
                  <span>Spent</span>
                  <span className="mono">{moneyCents(rollup.costCents)}</span>
                </div>
                {unpaidBillsCents > 0 && (
                  <div className="estdoc-total-row">
                    <span>Unpaid vendor bills (money not yet out)</span>
                    <span className="mono">{moneyCents(unpaidBillsCents)}</span>
                  </div>
                )}
                <div className="estdoc-total-row estdoc-grand">
                  <span>Net cash (collected − spent)</span>
                  <span className="mono">{moneyCents(rollup.netCashCents)}</span>
                </div>
              </>
            )}
          </div>

          {!clientView && items.length > 0 && (
            <>
              <h2 className="estdoc-terms-head">Job steps</h2>
              <table className="estdoc-items estdoc-schedule-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Due</th>
                    <th>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.label}
                        {i.note && <div className="estdoc-muted">{i.note}</div>}
                      </td>
                      <td className="estdoc-muted">{shortDate(i.due_date)}</td>
                      <td>
                        {i.completed_at ? (
                          `✓ ${shortDate(i.completed_at)}`
                        ) : i.due_date && i.due_date < todayISO ? (
                          <strong>overdue</strong>
                        ) : (
                          <span className="estdoc-muted">open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="estdoc-terms">
            {clientView ? (
              <p>
                Paid to date counts payments that have settled. A payment still in transit
                appears once it lands. Remaining on contract is the signed total less what
                has been paid — not necessarily what is due today, which follows the payment
                schedule above.
              </p>
            ) : (
              <p>
                Collected counts only settled payments. Owed to you is what has been billed
                and not yet paid. Spent is recorded job costs; unpaid vendor bills sit beside
                it because that money has not left yet. Net cash is collected less spent.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
