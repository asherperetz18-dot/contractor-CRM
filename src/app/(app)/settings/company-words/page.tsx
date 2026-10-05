import { AdminGate } from "@/components/admin-gate";
import { getCompanyWordsSettings } from "@/lib/actions/settings";
import { CompanyWordsForm } from "./company-words-form";

export const dynamic = "force-dynamic";

export default async function CompanyWordsPage() {
  const settings = await getCompanyWordsSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Company Words</h1>
          <p className="module-sub">
            The words your customers read. A plumber sends a Quote for a Job, a remodeler an Estimate for a
            Project &mdash; pick the ones your business uses.
          </p>
        </div>
      </div>
      {settings && <CompanyWordsForm initial={settings} />}
    </AdminGate>
  );
}
