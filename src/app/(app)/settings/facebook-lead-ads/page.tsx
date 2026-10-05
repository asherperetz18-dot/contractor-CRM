import { headers } from "next/headers";
import { getFacebookLeadAdsStatus, getMetaManualSetup } from "@/lib/actions/facebook-lead-ads";
import { AdminGate } from "@/components/admin-gate";
import { FacebookConnect } from "./facebook-connect";
import { MetaSettings } from "./meta-settings";

export default async function FacebookLeadAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  // Admins only, and only whether a Page token or app secret is saved:
  // the keys themselves never reach the browser (DECISIONS #114).
  const setup = await getMetaManualSetup();
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
        {!viaLogin && setup && (
          <MetaSettings
            origin={origin}
            open={Boolean(connection) || !status?.configured}
            problem={connection && !connection.health.ok ? connection.health.problem : null}
            config={{
              meta_page_id: setup.meta_page_id,
              meta_verify_token: setup.meta_verify_token,
              hasPageAccessToken: setup.hasPageAccessToken,
              hasAppSecret: setup.hasAppSecret,
            }}
          />
        )}
      </div>
    </AdminGate>
  );
}
