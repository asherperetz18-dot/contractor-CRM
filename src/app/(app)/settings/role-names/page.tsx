import Link from "next/link";
import { AdminGate } from "@/components/admin-gate";
import { getRoleNamesSettings } from "@/lib/actions/settings";
import { RoleNamesForm } from "./role-names-form";

export const dynamic = "force-dynamic";

export default async function RoleNamesPage() {
  const settings = await getRoleNamesSettings();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Role Names</h1>
          <p className="module-sub">
            What your company calls each team role, e.g. Technicians instead of Sales. Only the name
            changes: what each role can see and do stays as set in{" "}
            <Link href="/settings/users-roles">Users &amp; Roles</Link> and{" "}
            <Link href="/settings/role-visibility">Role Visibility</Link>.
          </p>
        </div>
      </div>
      {settings && <RoleNamesForm initial={settings} />}
    </AdminGate>
  );
}
