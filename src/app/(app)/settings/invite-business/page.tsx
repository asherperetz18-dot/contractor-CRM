import { AdminGate } from "@/components/admin-gate";
import { InviteBusinessForm } from "./invite-business-form";

export default function InviteBusinessPage() {
  // Office or Admin, same as who can already add a company from the
  // company switcher (createCompany in lib/actions/company.ts) -- this is
  // the other way to get a new company into the system, not a more
  // sensitive one.
  return (
    <AdminGate>
      <InviteBusinessForm />
    </AdminGate>
  );
}
