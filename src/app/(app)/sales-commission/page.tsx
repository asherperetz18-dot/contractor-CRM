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
export default async function SalesCommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string }>;
}) {
  // URL-synced like Payments' rep filter, so a filtered view can be
  // bookmarked; the table narrows everything on it to this person.
  const { rep } = await searchParams;
  return (
    <div>
      <RepCommissionTable repFilter={rep ?? ""} />
    </div>
  );
}
