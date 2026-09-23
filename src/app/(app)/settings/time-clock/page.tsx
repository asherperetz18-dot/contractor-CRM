import { AdminGate } from "@/components/admin-gate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { readTimeClockSettings } from "@/lib/data/time-clock";
import { TimeClockSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function TimeClockSettingsPage() {
  const profile = await getCurrentProfile();
  const settings = profile ? await readTimeClockSettings(await createClient(), profile.company_id) : null;
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Time Clock &amp; Tracking</h1>
          <p className="module-sub">Office only. Changes apply to everyone in the company.</p>
        </div>
      </div>
      {settings && <TimeClockSettingsForm initial={settings} />}
    </AdminGate>
  );
}
