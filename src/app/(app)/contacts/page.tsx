import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canDeleteLeads,
  canEditDispatch,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadNote,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { ContactsTable } from "./contacts-table";

export default async function ContactsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);

  const [
    { data: leads },
    { data: notes },
    { data: files },
    { data: reps },
    { data: stages },
    { data: calendars },
  ] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("lead_notes")
      .select("id, lead_id, author_id, body, event_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_files")
      .select("id, lead_id, uploaded_by, file_name, file_path, file_url, file_size, content_type, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, can_delete_leads, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").order("sort_order", { ascending: true }),
  ]);

  return (
    <ContactsTable
      leads={(leads as Lead[]) ?? []}
      notes={(notes as LeadNote[]) ?? []}
      files={(files as LeadFile[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
