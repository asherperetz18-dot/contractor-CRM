import { AdminGate } from "@/components/admin-gate";
import { getSalesCommissionDefaults } from "@/lib/actions/rep-commission";
import { SalesDefaultsForm } from "./defaults-form";

export const dynamic = "force-dynamic";

export default async function SalesCommissionSettingsPage() {
  const defaults = await getSalesCommissionDefaults();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Commission &amp; Lead Cost Defaults</h1>
          <p className="module-sub">
            What a salesperson earns on a job, and what the lead is charged against it
          </p>
        </div>
      </div>
      <SalesDefaultsForm
        initialCommissionBp={defaults.sales_commission_bp}
        initialLeadCostBp={defaults.sales_lead_cost_bp}
      />
    </AdminGate>
  );
}
