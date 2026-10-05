import { AdminGate } from "@/components/admin-gate";
import { getDepositRule } from "@/lib/actions/settings";
import { ContractsView } from "./contracts-view";
import { DepositRuleCard } from "./deposit-rule-card";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const deposit = await getDepositRule();
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
      {deposit && <DepositRuleCard initial={deposit} />}
      <ContractsView />
    </AdminGate>
  );
}
