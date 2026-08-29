import { AdminGate } from "@/components/admin-gate";
import { CompanyCallRail } from "./company-callrail";

export const dynamic = "force-dynamic";

export default function CallRailSettingsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">CallRail</h1>
          <p className="module-sub">
            Call tracking for your marketing sites &mdash; which ad made the phone ring
          </p>
        </div>
      </div>
      <CompanyCallRail />
    </AdminGate>
  );
}
