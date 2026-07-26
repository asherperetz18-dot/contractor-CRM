import { isAdminRole } from "@/lib/data/types";
import { getCurrentProfile } from "@/lib/data/profile";

export async function AdminGate({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  if (!isAdminRole(profile)) {
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
            Admin Settings is only available to users with the Office or Admin role.
          </p>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
