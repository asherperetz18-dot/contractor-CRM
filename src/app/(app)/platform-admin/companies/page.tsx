import { PlatformAdminGate } from "@/components/platform-admin-gate";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { listCompanyDirectory } from "@/lib/data/platform-admin";
import { CompaniesView } from "./companies-view";

// Every company on the platform, for whoever operates it (DECISIONS
// #127). Same gate as /platform-admin, and the list is only read for
// someone who passes it.
export default async function PlatformCompaniesPage() {
  const profile = await getCurrentProfile();
  const companies = isPlatformAdmin(profile) ? await listCompanyDirectory() : [];

  return (
    <PlatformAdminGate>
      <CompaniesView companies={companies} />
    </PlatformAdminGate>
  );
}
