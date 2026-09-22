import { companyNow } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { isoDay, presetWindow } from "@/lib/data/date-range";
import { getDashboardRollup } from "@/lib/actions/dashboard";
import type { Event, Lead, PipelineStageRow, RolePageVisibilityRow } from "@/lib/data/types";
import { NAV, filterNavForProfile } from "@/lib/nav";
import { MobileDashboard, type MobileModule } from "./mobile-dashboard";
import { DashboardView } from "./dashboard-view";

export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // The office's calendar, not the server's: Vercel's clock is UTC, and
  // from 5pm Pacific "today" there is already tomorrow. `now` is a
  // calendar Date (its local getters read the company wall clock);
  // anything measured in hours starts from the real instant instead.
  const now = await companyNow();
  const todayISO = isoDay(now);

  // One reduced call (dashboard_rollup, 0162, with a tested fallback)
  // serves the dashboard on every screen size -- the phone widgets that
  // used to need their own task/call/week/month queries are gone, since
  // the dashboard itself now renders on phones and shows all of that.
  const [rollup, recentLeads, nextEvents, stagesRes, members, visibilityRows] =
    await Promise.all([
      getDashboardRollup(presetWindow("month", now)),
      supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("events")
        .select("*")
        .eq("company_id", companyId)
        .gte("date", todayISO)
        .order("date", { ascending: true })
        .order("time", { ascending: true })
        .limit(5),
      supabase
        .from("pipeline_stages")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true }),
      profile ? getCompanyMembers(companyId) : Promise.resolve([]),
      supabase
        .from("role_page_visibility")
        .select("id, role, page_key, visible")
        .eq("company_id", companyId),
    ]);

  const overrides = (visibilityRows.data as RolePageVisibilityRow[]) ?? [];
  const filteredNav = profile ? filterNavForProfile(NAV, profile, overrides) : [];
  const modules: MobileModule[] = [];
  for (const entry of filteredNav) {
    if (entry.type === "link") {
      if (entry.href !== "/") modules.push({ label: entry.label, href: entry.href, icon: entry.icon });
    } else {
      for (const item of entry.items) {
        if (item.href) modules.push({ label: item.label, href: item.href, icon: entry.icon });
      }
    }
  }

  // Name lookups read the whole roster on purpose -- narrowing them
  // turns historical assignees into "Unnamed".
  const repNames = Object.fromEntries(
    members.map((m) => [m.id, m.name || m.email || "Unnamed"])
  ) as Record<string, string>;

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dashboard</h1>
          <p className="module-sub">Overview of your business</p>
        </div>
      </div>

      <DashboardView
        initialRollup={rollup}
        savedPanelOrder={profile?.dashboard_panel_order ?? null}
        canMoney={canViewFinancials(profile)}
        stages={(stagesRes.data as PipelineStageRow[]) ?? []}
        repNames={repNames}
        recentLeads={(recentLeads.data as Lead[] | null) ?? []}
        nextEvents={(nextEvents.data as Event[] | null) ?? []}
      />

      <MobileDashboard modules={modules} />
    </>
  );
}
