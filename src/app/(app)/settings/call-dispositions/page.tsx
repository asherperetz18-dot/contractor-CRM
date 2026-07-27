import { createClient } from "@/lib/supabase/server";
import type { CallDispositionRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CallDispositionsTable } from "./call-dispositions-table";

export default async function CallDispositionsPage() {
  const supabase = await createClient();
  const { data: dispositions } = await supabase
    .from("call_dispositions")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <AdminGate>
      <CallDispositionsTable dispositions={(dispositions as CallDispositionRow[]) ?? []} />
    </AdminGate>
  );
}
