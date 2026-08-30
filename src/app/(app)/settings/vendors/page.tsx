import { getCurrentProfile } from "@/lib/data/profile";
import { canEditVendors } from "@/lib/data/types";
import { getVendors } from "@/lib/actions/vendors";
import { VendorsView } from "./vendors-view";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Not canManageCosts: Field records receipts but the vendors_write
  // policy (0079) does not include them, and an edit form whose saves
  // the database refuses is worse than no form.
  const canEdit = canEditVendors(profile);
  // Archived vendors are included: this is where somebody comes to bring
  // one back, and a list that hides them makes that look impossible.
  const { vendors, error } = await getVendors(true);

  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-label">Couldn&apos;t load vendors</p>
        <p className="empty-hint">{error}</p>
      </div>
    );
  }

  return <VendorsView vendors={vendors ?? []} canEdit={canEdit} />;
}
