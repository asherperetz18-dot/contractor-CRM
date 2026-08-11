import { AdminGate } from "@/components/admin-gate";
import { CertificatesView } from "./certificates-view";

export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Licence &amp; Insurance</h1>
          <p className="module-sub">
            The certificates customers are entitled to ask for, shown on their portal
            instead of texted one at a time
          </p>
        </div>
      </div>
      <CertificatesView />
    </AdminGate>
  );
}
