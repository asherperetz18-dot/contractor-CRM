import { RepCommissionTable } from "./rep-commission-table";

export const dynamic = "force-dynamic";

/**
 * Sales commission, on its own page.
 *
 * Kept apart from the dispatcher's. They are different schemes paid to
 * different people out of different money -- the dispatcher earns a
 * percentage of the gross sale for bringing the lead in, the rep earns a
 * share of what the job actually made. Stacking them on one page invited
 * the two to be read as one number, and meant opening the page to reps
 * also showed them the dispatcher scheme.
 */
export default function SalesCommissionPage() {
  return (
    <div>
      <RepCommissionTable />
    </div>
  );
}
