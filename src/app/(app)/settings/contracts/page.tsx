import { AdminGate } from "@/components/admin-gate";
import { ContractsView } from "./contracts-view";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Contracts</h1>
          <p className="module-sub">
            The agreement your customers sign. Copied onto each estimate when it is
            created, so editing one here never changes a contract already signed.
          </p>
        </div>
      </div>
      <ContractsView />
    </AdminGate>
  );
}
