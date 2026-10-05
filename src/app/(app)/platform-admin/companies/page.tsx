import { PlatformAdminGate } from "@/components/platform-admin-gate";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { listCompanyDirectory } from "@/lib/data/platform-admin";
import { CompaniesView } from "./companies-view";
import { getCompanyZone } from "@/lib/data/company-today";

// Every company on the platform, for whoever operates it (DECISIONS
// #127). Same gate as /platform-admin, and the list is only read for
// someone who passes it.
export default async function PlatformCompaniesPage() {
  const profile = await getCurrentProfile();
  const companies = isPlatformAdmin(profile) ? await listCompanyDirectory() : [];

  return (
    <PlatformAdminGate>
      {/* Trial end dates in the zone of the company the admin is in now,
          the same text on the server and in the browser. */}
      <CompaniesView companies={companies} zone={await getCompanyZone()} />
    </PlatformAdminGate>
  );
}
