import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type TemplateItem = { label: string; offset_days: number | null };

/** Templates stored before offsets existed hold bare strings. */
export function normalizeTemplateItems(raw: unknown): TemplateItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it): TemplateItem | null => {
      if (typeof it === "string") return { label: it, offset_days: null };
      if (it && typeof it === "object" && typeof (it as { label?: unknown }).label === "string") {
        const off = (it as { offset_days?: unknown }).offset_days;
        return {
          label: (it as { label: string }).label,
          offset_days: typeof off === "number" && Number.isFinite(off) ? Math.round(off) : null,
        };
      }
      return null;
    })
    .filter((x): x is TemplateItem => !!x && !!x.label.trim());
}

/** signing day + N days, as a date column value. */
export function dueFromOffset(baseIso: string, offsetDays: number): string {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * The moment a contract is signed, the company's auto-apply template
 * (if it has one) becomes the job's checklist, every offset step dated
 * off the signing day -- "file for permit: 3 days after signing" with
 * nobody computing anything. Skipped when the job already has a
 * checklist: a list someone curated must not be appended to by a robot.
 */
export async function applyAutoChecklist(
  admin: Admin,
  companyId: string,
  estimateId: string,
  signedAtIso: string
): Promise<void> {
  try {
    const [{ data: template }, { data: existing }] = await Promise.all([
      admin
        .from("checklist_templates")
        .select("items")
        .eq("company_id", companyId)
        .eq("auto_apply", true)
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle<{ items: unknown }>(),
      admin
        .from("project_checklist_items")
        .select("id")
        .eq("estimate_id", estimateId)
        .limit(1),
    ]);
    if (!template || (existing ?? []).length) return;

    const items = normalizeTemplateItems(template.items);
    if (!items.length) return;

    await admin.from("project_checklist_items").insert(
      items.map((it, i) => ({
        company_id: companyId,
        estimate_id: estimateId,
        label: it.label,
        sort_order: i,
        due_date: it.offset_days !== null ? dueFromOffset(signedAtIso, it.offset_days) : null,
      }))
    );
  } catch {
    // The signature is the sacred act here; a checklist hiccup must
    // never surface as a signing failure.
  }
}
