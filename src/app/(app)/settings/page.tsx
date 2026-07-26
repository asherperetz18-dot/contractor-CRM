import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { SettingsGrid } from "./settings-grid";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  const isOffice = profile?.roles.includes("Office") ?? false;

  if (!isOffice) {
    return (
      <>
        <div className="module-toolbar">
          <div>
            <h1 className="module-title">Admin Settings</h1>
            <p className="module-sub">Company configuration</p>
          </div>
        </div>
        <div className="empty-state">
          <p className="empty-label">Office access required</p>
          <p className="empty-hint">
            Admin Settings is only available to users with the Office role.
          </p>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("logo_url")
    .eq("id", 1)
    .single();

  return (
    <SettingsGrid
      logoUrl={(companyProfile as { logo_url: string | null } | null)?.logo_url ?? null}
    />
  );
}
