import { AdminGate } from "@/components/admin-gate";
import { getFinancingSettings } from "@/lib/actions/financing";
import { FinancingForm, FinancingOfferForm } from "./financing-form";

export const dynamic = "force-dynamic";

/** The lender the company's customers apply to (DECISIONS #161). */
export default async function CustomerFinancingPage() {
  const settings = await getFinancingSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Customer Financing</h1>
          <p className="module-sub">
            Let customers apply for financing with your lender, from their estimates and contracts.
          </p>
        </div>
      </div>
      {settings && <FinancingForm initial={settings} />}
      {/* Who sees it, and what it costs (DECISIONS #169). */}
      {settings && <FinancingOfferForm initial={settings.offer} />}
    </AdminGate>
  );
}
