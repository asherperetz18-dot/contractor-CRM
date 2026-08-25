import { AdminGate } from "@/components/admin-gate";
import { CompanyEmail } from "./company-email";

export const dynamic = "force-dynamic";

export default function EmailSettingsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Email Sender</h1>
          <p className="module-sub">
            The address estimates and portal links send from
          </p>
        </div>
      </div>
      <CompanyEmail />
    </AdminGate>
  );
}
