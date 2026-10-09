import { AdminGate } from "@/components/admin-gate";
import { companyToday } from "@/lib/data/company-today";
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
      {/* The company's today: a certificate is valid all of its expiry
          day there, as the portal counts it. */}
      <CertificatesView today={await companyToday()} />
    </AdminGate>
  );
}
