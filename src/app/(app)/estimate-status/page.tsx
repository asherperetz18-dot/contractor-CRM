import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewEstimates, moneyCents } from "@/lib/data/types";
import { estimateFlowStatus } from "@/lib/estimate-flow-status";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Where each of the viewer's documents stands: who it is waiting on.
 *
 * The rep-side mirror of the admin's Approvals screen. A rep drafting
 * under the approval gate or a closer's hold has no way to see "did the
 * admin approve it yet? did the closer send it?" without opening every
 * document -- this page answers it as a list. RLS scopes the rows, so a
 * sales-scoped rep sees the jobs they hold a seat on and Office/Admin
 * see the company; nothing here can widen anyone's reach.
 *
 * Reads are capped (newest 250 in-flight documents) rather than a scan
 * of the book, and signed documents drop off after 30 days -- this is a
 * status board, not the archive; the archive is Estimates & Contracts.
 */
export default async function EstimateStatusPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewEstimates(profile)) {
    // The explicit refusal, not a silent empty list -- same rule as the
    // estimates module: missing permission must never read as no work.
    return (
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Estimate Status</h1>
          <p className="module-sub">
            You don&rsquo;t have access to estimates. Ask an Office or Admin user for View
            Estimates access in Users &amp; Roles.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();

  // A status board shows the live pipeline: completion certificates are
  // paperwork after the sale, and a signature older than a month is the
  // archive's business. Both exclusions happen IN the query, before the
  // row cap -- filtering after `.limit()` would let a pile of old signed
  // documents push genuine in-flight drafts out of the window.
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoff = cutoffDate.toISOString();

  const [{ data: docs }, { data: companyRow }] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, doc_number, title, status, kind, total_cents, lead_id, approved_at, signed_at, updated_at")
      .eq("company_id", profile.company_id)
      .in("status", ["Draft", "Sent", "Viewed", "Signed"])
      .or("kind.is.null,kind.neq.completion")
      // Signed rows only while fresh; a Signed row missing signed_at
      // (older data) falls back to its updated_at, same as the paper
      // trail would read it.
      .or(
        `status.neq.Signed,signed_at.gte.${cutoff},and(signed_at.is.null,updated_at.gte.${cutoff})`
      )
      .order("updated_at", { ascending: false })
      .limit(250)
      .returns<
        {
          id: string;
          doc_number: string | null;
          title: string | null;
          status: string;
          kind: string | null;
          total_cents: number | null;
          lead_id: string | null;
          approved_at: string | null;
          signed_at: string | null;
          updated_at: string | null;
        }[]
      >(),
    supabase
      .from("company_profile")
      .select("require_estimate_approval")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ require_estimate_approval: boolean | null }>(),
  ]);

  const approvalRequired = companyRow?.require_estimate_approval === true;
  const rows = docs ?? [];

  // Only the leads these rows reference -- never the book.
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
  const { data: leads } = leadIds.length
    ? await supabase
        .from("leads")
        .select("id, first_name, last_name, company_name, closer_id")
        .in("id", leadIds)
        .returns<
          {
            id: string;
            first_name: string | null;
            last_name: string | null;
            company_name: string | null;
            closer_id: string | null;
          }[]
        >()
    : { data: [] as never[] };
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));

  const closerIds = [
    ...new Set((leads ?? []).map((l) => l.closer_id).filter(Boolean)),
  ] as string[];
  const { data: closers } = closerIds.length
    ? await supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", closerIds)
        .returns<{ id: string; name: string | null; email: string | null }[]>()
    : { data: [] as never[] };
  const closerNameById = new Map(
    (closers ?? []).map((p) => [p.id, p.name || p.email || "the closer"])
  );

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Estimate Status</h1>
          <p className="module-sub">
            Who each document is waiting on &mdash; admin approval, the closer&rsquo;s review,
            or the customer&rsquo;s signature
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty-label">
          Nothing in flight. Documents appear here the moment a draft exists, and signed ones
          drop off after 30 days.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Customer</th>
                <th className="right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lead = r.lead_id ? leadById.get(r.lead_id) : undefined;
                const customer =
                  [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") ||
                  lead?.company_name ||
                  "—";
                const closerId = lead?.closer_id ?? null;
                const flow = estimateFlowStatus({
                  status: r.status,
                  approvedAt: r.approved_at,
                  approvalRequired,
                  closerId,
                  closerName: closerId ? closerNameById.get(closerId) : null,
                  viewerId: profile.id,
                });
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/estimates/${r.id}`}>
                        {r.doc_number || "Draft"}
                        {r.title ? ` · ${r.title}` : ""}
                      </Link>
                    </td>
                    <td>{customer}</td>
                    <td className="right mono">
                      {r.total_cents ? moneyCents(r.total_cents) : "—"}
                    </td>
                    <td>
                      <Badge color={flow.color}>{flow.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
