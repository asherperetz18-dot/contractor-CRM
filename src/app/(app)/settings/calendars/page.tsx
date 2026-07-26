import { createClient } from "@/lib/supabase/server";
import type { CalendarRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CalendarsTable } from "./calendars-table";

export default async function CalendarsPage() {
  const supabase = await createClient();
  const { data: calendars } = await supabase
    .from("calendars")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <CalendarsTable calendars={(calendars as CalendarRow[]) ?? []} />
    </AdminGate>
  );
}
