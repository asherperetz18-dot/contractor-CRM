"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireOfficeOrAdmin(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: string[] } | null)?.roles ?? [];
  if (!roles.includes("Office") && !roles.includes("Admin")) {
    return { error: "Only Office or Admin users can manage calendars." };
  }
  return {};
}

function revalidateCalendarRoutes() {
  revalidatePath("/settings/calendars");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
}

export async function createCalendar(
  name: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Calendar name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("calendars")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("calendars").insert({
    name: trimmed,
    color: color || "#7C8798",
    sort_order: nextOrder,
    is_system: false,
  });
  if (error) {
    if (error.code === "23505") return { error: "A calendar with that name already exists." };
    return { error: error.message };
  }

  revalidateCalendarRoutes();
  return {};
}

export async function renameCalendar(
  id: string,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Calendar name is required." };

  const supabase = await createClient();
  const { data: cal } = await supabase
    .from("calendars")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = cal as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Calendar not found." };
  if (current.is_system) return { error: "System calendars cannot be renamed." };
  if (current.name === trimmed) return {};

  const { error } = await supabase
    .from("calendars")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "A calendar with that name already exists." };
    return { error: error.message };
  }

  // Keep existing appointments pointed at the renamed calendar.
  await supabase.from("events").update({ event_type: trimmed }).eq("event_type", current.name);

  revalidateCalendarRoutes();
  return {};
}

export async function updateCalendarColor(
  id: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from("calendars").update({ color }).eq("id", id);
  if (error) return { error: error.message };

  revalidateCalendarRoutes();
  return {};
}

export async function deleteCalendar(id: string): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { data: cal } = await supabase
    .from("calendars")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = cal as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Calendar not found." };
  if (current.is_system) return { error: "System calendars cannot be deleted." };

  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", current.name);
  if (count && count > 0) {
    return {
      error: `${count} appointment${count === 1 ? "" : "s"} still use this calendar. Move them first.`,
    };
  }

  const { error } = await supabase.from("calendars").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateCalendarRoutes();
  return {};
}

export async function reorderCalendars(orderedIds: string[]): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("calendars").update({ sort_order: index + 1 }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidateCalendarRoutes();
  return {};
}
