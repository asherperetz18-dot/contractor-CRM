import { companyNow } from "@/lib/data/company-today";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { presetWindow } from "@/lib/data/date-range";
import { getDispatchRollup } from "@/lib/actions/dispatch-dashboard";
import { DispatchDashboardView } from "./dispatch-dashboard-view";

/**
 * The desk's own overview: is every lead being worked fast, and is the
 * calendar filling. Live problems first (untouched new leads, replies,
 * overdue follow-ups, today's unconfirmed visits, results owed), then
 * the period's pace, then today's board and the desk table.
 *
 * One reduced call (dispatch_rollup, 0171, with a tested fallback) --
 * the same posture as the main Dashboard. Role Visibility gates the
 * page like any other; RLS scopes a non-supervisor dispatcher to their
 * own leads, so their numbers are their own.
 */
export default async function DispatchDashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // The office's calendar, not the server's -- same reasoning as the
  // main Dashboard: from 5pm Pacific, UTC "today" is already tomorrow.
  const now = await companyNow();

  const [rollup, members] = await Promise.all([
    getDispatchRollup(presetWindow("7", now)),
    getCompanyMembers(profile.company_id),
  ]);

  // Name lookups read the whole roster on purpose -- narrowing them
  // turns a former dispatcher's row into "Unnamed".
  const names = Object.fromEntries(
    members.map((m) => [m.id, m.name || m.email || "Unnamed"])
  ) as Record<string, string>;

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dispatch Dashboard</h1>
          <p className="module-sub">New leads in, appointments out</p>
        </div>
      </div>
      <DispatchDashboardView initialRollup={rollup} names={names} />
    </>
  );
}
