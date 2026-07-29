import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { CalendarRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CalendarsTable } from "./calendars-table";

export default async function CalendarsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data: calendars } = await supabase
    .from("calendars")
    .select("*")
    .eq("company_id", companyId ?? "")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <CalendarsTable calendars={(calendars as CalendarRow[]) ?? []} />
    </AdminGate>
  );
}
