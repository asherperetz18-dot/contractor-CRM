import { AdminGate } from "@/components/admin-gate";
import { getDispatcherCommissionRate } from "@/lib/actions/dispatcher";
import { CommissionRateForm } from "./rate-form";

export const dynamic = "force-dynamic";

export default async function DispatcherCommissionPage() {
  const rate = await getDispatcherCommissionRate();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dispatcher Commission</h1>
          <p className="module-sub">
            What a dispatcher earns when a lead they hold turns into a signed contract
          </p>
        </div>
      </div>
      <CommissionRateForm initialPercent={rate ?? 1} />
    </AdminGate>
  );
}
