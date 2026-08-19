import { AdminGate } from "@/components/admin-gate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { NAV, navEntryKey, sortNavEntries } from "@/lib/nav";
import { MenuOrderView } from "./menu-order-view";

export const dynamic = "force-dynamic";

export default async function MenuOrderPage() {
  const profile = await getCurrentProfile();
  let saved: string[] = [];
  if (profile) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("company_profile")
      .select("nav_order")
      .eq("company_id", profile.company_id)
      .single<{ nav_order: string[] | null }>();
    saved = data?.nav_order ?? [];
  }

  // The full menu in its currently-saved order, unfiltered by role --
  // the admin is arranging the menu everyone sees, including entries
  // their own roles happen to hide. Admin Settings is pinned last by
  // sortNavEntries and not offered for moving.
  const rows = sortNavEntries(NAV, saved)
    .filter((e) => !(e.type === "link" && e.href === "/settings"))
    .map((e) => ({ key: navEntryKey(e), label: e.label, icon: e.icon }));

  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Menu Order</h1>
          <p className="module-sub">
            Arrange the sidebar — the whole company sees the same order
          </p>
        </div>
      </div>
      <MenuOrderView rows={rows} hasCustomOrder={saved.length > 0} />
    </AdminGate>
  );
}
