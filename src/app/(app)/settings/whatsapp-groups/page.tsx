import { AdminGate } from "@/components/admin-gate";
import { CompanyWhatsApp } from "./company-whatsapp";

export const dynamic = "force-dynamic";

export default function WhatsAppGroupsSettingsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">WhatsApp Groups</h1>
          <p className="module-sub">
            A project bot number in each project&apos;s WhatsApp group &mdash; every message and photo lands on
            that project
          </p>
        </div>
      </div>
      <CompanyWhatsApp />
    </AdminGate>
  );
}
