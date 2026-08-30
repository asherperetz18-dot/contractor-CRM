import { AdminGate } from "@/components/admin-gate";
import { InboundEmailSettings } from "./inbound-email-settings";

export const dynamic = "force-dynamic";

export default function InboundEmailPage() {
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Lead Email Intake</h1>
          <p className="module-sub">
            Forward any lead-source email here and it becomes a lead &mdash; Home Depot Pro
            Referral, Angi, Yelp, answering services
          </p>
        </div>
      </div>
      <InboundEmailSettings />
    </AdminGate>
  );
}
