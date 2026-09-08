import { AdminGate } from "@/components/admin-gate";
import { getPendingApprovals, getApprovalSetting } from "@/lib/actions/estimate-approval";
import { ApprovalsView } from "./approvals-view";

export const dynamic = "force-dynamic";

/**
 * Documents waiting to be approved before they go to a customer.
 *
 * Its own page rather than a button on the estimate: the question this
 * answers is "what is waiting on me", which is a list, and an admin
 * should not have to open eleven estimates to find the two that need
 * looking at.
 */
export default async function EstimateApprovalsPage() {
  const [{ pending, error }, { required }] = await Promise.all([
    getPendingApprovals(),
    getApprovalSetting(),
  ]);

  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Approvals</h1>
          <p className="module-sub">
            Drafts waiting to be checked before they go to a customer
          </p>
        </div>
      </div>
      <ApprovalsView
        initialPending={pending ?? []}
        initialRequired={required}
        loadError={error ?? ""}
      />
    </AdminGate>
  );
}
