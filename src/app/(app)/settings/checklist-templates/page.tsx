import { AdminGate } from "@/components/admin-gate";
import { getChecklistTemplates } from "@/lib/actions/checklists";
import { ChecklistTemplatesView } from "./checklist-templates-view";

export const dynamic = "force-dynamic";

export default async function ChecklistTemplatesPage() {
  const { templates } = await getChecklistTemplates();
  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Checklist Templates</h1>
          <p className="module-sub">
            Reusable step lists for projects — apply one to any sold job on the Projects page
            and check the steps off as the work happens
          </p>
        </div>
      </div>
      <ChecklistTemplatesView templates={templates ?? []} />
    </AdminGate>
  );
}
