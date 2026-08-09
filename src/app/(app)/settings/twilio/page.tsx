import { AdminGate } from "@/components/admin-gate";
import { CompanyTwilio } from "./company-twilio";

export const dynamic = "force-dynamic";

export default function TwilioSettingsPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Twilio Account &amp; Number</h1>
          <p className="module-sub">
            The phone number this company texts and calls from
          </p>
        </div>
      </div>
      <CompanyTwilio />
    </AdminGate>
  );
}
