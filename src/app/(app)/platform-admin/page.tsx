import { PlatformAdminGate } from "@/components/platform-admin-gate";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { listInviteHistory, listPlatformAdmins } from "@/lib/data/platform-admin";
import { PlatformAdminView } from "./platform-admin-view";

// Not under /settings: every other card there is scoped to "the company
// you're currently in" (AdminGate, Office-or-Admin of that one company).
// This page answers a different question -- does this identity operate
// the platform -- so it gets its own gate (PlatformAdminGate) and its
// own place in the nav (the Admin Tools menu, not the Settings grid).
export default async function PlatformAdminPage() {
  // getCurrentProfile() is cache()-wrapped, so this costs nothing extra
  // even though PlatformAdminGate below reads it too.
  const profile = await getCurrentProfile();

  // Checked here, not just inside the gate below: listPlatformAdmins()
  // queries is_platform_admin, and skipping it for anyone who fails this
  // check means a curious Office/Admin who is not a Platform Admin never
  // pays for that query -- and, until migration 0132 has run, never hits
  // the column-does-not-exist error it would raise, since nobody can
  // pass this check before the migration exists to make it true.
  const [admins, invites] = isPlatformAdmin(profile)
    ? await Promise.all([listPlatformAdmins(), listInviteHistory()])
    : [[], []];

  // Read once here so every history row is judged against the same
  // instant (the view is a client component and may not read the clock
  // in render).
  const now = new Date().getTime();

  return (
    <PlatformAdminGate>
      <PlatformAdminView admins={admins} invites={invites} now={now} selfId={profile?.id ?? ""} />
    </PlatformAdminGate>
  );
}
