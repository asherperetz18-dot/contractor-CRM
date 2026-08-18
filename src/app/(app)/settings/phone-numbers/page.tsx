import { AdminGate } from "@/components/admin-gate";
import { listCompanyPhoneNumbers } from "@/lib/actions/phone-numbers";
import { PhoneNumbersView } from "./phone-numbers-view";

export const dynamic = "force-dynamic";

export default async function PhoneNumbersSettingsPage() {
  // Loaded here rather than by the client after mount, so the list is
  // on screen with the page instead of arriving late.
  const numbers = await listCompanyPhoneNumbers();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Phone Numbers</h1>
          <p className="module-sub">
            Every number this company can call from — reps pick one in the dialer
          </p>
        </div>
      </div>
      <PhoneNumbersView initial={numbers} />
    </AdminGate>
  );
}
