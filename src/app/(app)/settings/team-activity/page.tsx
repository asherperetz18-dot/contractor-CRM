import { isStrictAdmin } from "@/lib/data/types";
import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import { getActivityEventsInRange } from "@/lib/actions/activity-range";
import { getCompanyMembers } from "@/lib/data/company";
import { AdminGate } from "@/components/admin-gate";
import { TeamActivityView } from "./team-activity-view";

/**
 * The report opens on today, so today is what is fetched.
 *
 * This page used to pull ninety days of raw events on every visit --
 * 26,705 rows and 3.4MB of them -- in twenty sequential round trips,
 * and hand the lot to the browser to narrow down. The default window is
 * about 1,800 events, so roughly fourteen fifteenths of that was
 * discarded before anything was drawn. Measured before the change: the
 * server began answering in 67ms and then spent 2,849ms streaming
 * 5.2MB.
 *
 * Widening the range now fetches that range, the same way the lead-view
 * figures beside it already worked.
 */
function startOfTodayISO(): string {
  // Sliced from the ISO string to match the report, which buckets days by
  // the UTC date rather than anyone's local one.
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
}

export default async function TeamActivityPage() {
  // Checked before the fetch, not just around the render: this page reads
  // every teammate's browsing history, and there's no reason to pull that
  // for someone who isn't allowed to see it.
  const profile = await getCurrentProfile();
  if (!isStrictAdmin(profile)) {
    return <AdminGate adminOnly>{null}</AdminGate>;
  }

  const since = startOfTodayISO();

  const companyId = await getCurrentCompanyId();
  const [initial, users] = await Promise.all([
    companyId ? getActivityEventsInRange(since) : Promise.resolve({ events: [] }),
    companyId ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  return (
    <AdminGate adminOnly>
      <TeamActivityView
        initialEvents={initial.events ?? []}
        initialSince={since}
        users={users}
      />
    </AdminGate>
  );
}
