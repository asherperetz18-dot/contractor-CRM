import { AdminGate } from "@/components/admin-gate";
import { CompanyPrimeCall } from "./company-primecall";

export const dynamic = "force-dynamic";

export default function PrimeCallSettingsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">PrimeCall</h1>
          <p className="module-sub">
            Your office phone system &mdash; every call lands in Call Reports and on the caller&apos;s card
          </p>
        </div>
      </div>
      <CompanyPrimeCall />
    </AdminGate>
  );
}
