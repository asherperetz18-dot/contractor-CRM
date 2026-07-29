import { getCurrentCompanyId } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { AdminGate } from "@/components/admin-gate";
import { UsersRolesTable } from "./users-roles-table";

export default async function UsersRolesPage() {
  const companyId = await getCurrentCompanyId();
  const users = companyId ? await getCompanyMembers(companyId) : [];
  users.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <AdminGate>
      <UsersRolesTable users={users} />
    </AdminGate>
  );
}
