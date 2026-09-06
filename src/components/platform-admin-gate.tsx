import { isPlatformAdmin } from "@/lib/data/types";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * Deliberately its own gate rather than AdminGate with a new flag on it:
 * AdminGate answers "Office/Admin (or Admin alone) of the company you're
 * currently in," and this answers a different question entirely --
 * "does this identity operate the platform" -- which an Office or Admin
 * of any given company, including a super admin, does not automatically
 * answer yes to. See isPlatformAdmin in lib/data/types.
 */
export async function PlatformAdminGate({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  if (!isPlatformAdmin(profile)) {
    return (
      <>
        <div className="module-toolbar">
          <div>
            <h1 className="module-title">Platform Admin</h1>
            <p className="module-sub">Operating the platform, not a single company</p>
          </div>
        </div>
        <div className="empty-state">
          <p className="empty-label">Platform Admin access required</p>
          <p className="empty-hint">
            This is separate from being Office or Admin of a company -- ask an
            existing Platform Admin to grant it to you.
          </p>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
