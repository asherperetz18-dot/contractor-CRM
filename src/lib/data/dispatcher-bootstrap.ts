import { isAdminRole, type Profile } from "@/lib/data/types";
import type { DispatcherPickerBootstrap } from "@/app/(app)/calendar/dispatcher-picker";

/**
 * The dispatcher picker's data, computed from what the page already
 * holds.
 *
 * Every page that opens a lead or appointment window already loads the
 * company's members and the signed-in profile -- the picker used to
 * fetch the same facts again for itself after mounting, and rendered
 * nothing for the seconds that took. Deriving it here costs no extra
 * query and puts the control on screen with the rest of the form.
 *
 * Mirrors getDispatchers/getDispatcherContext exactly: active members
 * holding Dispatch, sorted by name; Office and Admin may assign anyone.
 */
export function dispatcherPickerBootstrap(
  profile: Pick<Profile, "id" | "roles"> | null,
  members: Pick<Profile, "id" | "name" | "email" | "roles" | "status">[]
): DispatcherPickerBootstrap | undefined {
  if (!profile) return undefined;
  return {
    options: members
      .filter((m) => m.status === "Active" && (m.roles ?? []).includes("Dispatch"))
      .map((m) => ({ id: m.id, name: m.name || m.email || "Unnamed" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    context: {
      selfId: profile.id,
      canAssignAnyone: isAdminRole(profile),
      isDispatcher: (profile.roles ?? []).includes("Dispatch"),
    },
  };
}
