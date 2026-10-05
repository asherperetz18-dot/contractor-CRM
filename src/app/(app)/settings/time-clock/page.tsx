import { AdminGate } from "@/components/admin-gate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { readClockInCheck, readTimeClockSettings } from "@/lib/data/time-clock";
import { TimeClockSettingsForm } from "./settings-form";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { STANDARD_ROLE_NAMES } from "@/lib/role-names";

export const dynamic = "force-dynamic";

export default async function TimeClockSettingsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [settings, check, roleNames] = profile
    ? await Promise.all([
        readTimeClockSettings(supabase, profile.company_id),
        readClockInCheck(supabase, profile.company_id),
        getRoleNamesCached(profile.company_id),
      ])
    : [null, null, STANDARD_ROLE_NAMES];
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Time Clock &amp; Tracking</h1>
          <p className="module-sub">Office only. Changes apply to everyone in the company.</p>
        </div>
      </div>
      {settings && <TimeClockSettingsForm initial={settings} checkReady={check !== null} roleNames={roleNames} />}
    </AdminGate>
  );
}
