import { isAdminRole, isStrictAdmin } from "@/lib/data/types";
import { getCurrentProfile } from "@/lib/data/profile";

export async function AdminGate({
  children,
  // Narrows the gate from "Office or Admin" to Admin alone, for pages
  // that report on the team rather than configure the company.
  adminOnly,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const profile = await getCurrentProfile();
  const allowed = adminOnly ? isStrictAdmin(profile) : isAdminRole(profile);

  if (!allowed) {
    return (
      <>
        <div className="module-toolbar">
          <div>
            <h1 className="module-title">Admin Settings</h1>
            <p className="module-sub">Company configuration</p>
          </div>
        </div>
        <div className="empty-state">
          <p className="empty-label">Admin access required</p>
          <p className="empty-hint">
            {adminOnly
              ? "This page is only available to users with the Admin role."
              : "Admin Settings is only available to users with the Office or Admin role."}
          </p>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
