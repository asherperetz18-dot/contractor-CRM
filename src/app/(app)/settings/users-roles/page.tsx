import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin } from "@/lib/data/types";
import { getCompanyMembers } from "@/lib/data/company";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { STANDARD_ROLE_NAMES } from "@/lib/role-names";
import { AdminGate } from "@/components/admin-gate";
import { UsersRolesTable } from "./users-roles-table";

export default async function UsersRolesPage() {
  const companyId = await getCurrentCompanyId();
  const profile = await getCurrentProfile();
  const [users, roleNames] = companyId
    ? await Promise.all([getCompanyMembers(companyId), getRoleNamesCached(companyId)])
    : [[], STANDARD_ROLE_NAMES];
  users.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <AdminGate>
      <UsersRolesTable users={users} isAdmin={isStrictAdmin(profile)} roleNames={roleNames} />
    </AdminGate>
  );
}
