import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { MetaConfigInput } from "@/lib/actions/settings";
import { getFacebookLeadAdsStatus } from "@/lib/actions/facebook-lead-ads";
import { AdminGate } from "@/components/admin-gate";
import { FacebookConnect } from "./facebook-connect";
import { MetaSettings } from "./meta-settings";

export default async function FacebookLeadAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data } = await supabase
    .from("company_profile")
    .select("meta_page_id, meta_page_access_token, meta_verify_token, meta_app_secret")
    .eq("company_id", companyId ?? "")
    .single();

  const config = data as Partial<MetaConfigInput> | null;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const status = await getFacebookLeadAdsStatus();
  const connection = status?.connection ?? null;
  const viaLogin = connection?.via === "facebook_login";

  return (
    <AdminGate>
      <div>
        <div className="module-toolbar">
          <div>
            <h1 className="module-title">Facebook Lead Ads</h1>
            <p className="module-sub">Auto-import leads from Facebook/Instagram Lead Ads</p>
          </div>
        </div>

        {error && <p className="error-note">{error}</p>}
        {connected && !error && (
          <p className="hint-note" style={{ color: "var(--success)" }}>
            ✓ Connected. The next person who fills in one of your lead forms shows up in Contacts &amp; Leads.
          </p>
        )}
        {status && !status.configured && (
          <p className="error-note">
            Connect with Facebook isn&apos;t configured on this deployment yet — the CRM&apos;s Meta app id and
            secret are needed. Until then, use the advanced setup below.
          </p>
        )}
        {status?.migrationMissing && (
          <p className="error-note">
            Connect with Facebook isn&apos;t set up in the database yet — an admin needs to run migration 0178.
          </p>
        )}

        {status && <FacebookConnect status={status} />}

        {/* A Page connected with Facebook is managed above; the manual form
            would only overwrite its token. */}
        {!viaLogin && (
          <MetaSettings
            origin={origin}
            open={Boolean(connection) || !status?.configured}
            problem={connection && !connection.health.ok ? connection.health.problem : null}
            config={{
              meta_page_id: config?.meta_page_id ?? "",
              meta_page_access_token: config?.meta_page_access_token ?? "",
              meta_verify_token: config?.meta_verify_token ?? "",
              meta_app_secret: config?.meta_app_secret ?? "",
            }}
          />
        )}
      </div>
    </AdminGate>
  );
}
