"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

type ConnectionRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected_email: string | null;
  folder_id: string | null;
};

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
    return { error: "Only Office or Admin users can manage cloud storage." };
  }
  return {};
}

export async function getGoogleDriveStatus(): Promise<{
  connected: boolean;
  email?: string;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_drive_connection")
    .select("connected_email")
    .eq("id", 1)
    .maybeSingle();
  const row = data as { connected_email: string | null } | null;
  if (!row?.connected_email) return { connected: false };
  return { connected: true, email: row.connected_email };
}

export async function disconnectGoogleDrive(): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const admin = createAdminClient();
  await admin.from("google_drive_connection").delete().eq("id", 1);

  revalidatePath("/settings/cloud-storage");
  return {};
}

// Returns a live access token, refreshing it first if it's expired or
// about to be. Returns null if Drive isn't connected at all.
export async function getValidAccessToken(): Promise<{
  accessToken: string;
  folderId: string;
} | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_drive_connection")
    .select("access_token, refresh_token, token_expires_at, folder_id")
    .eq("id", 1)
    .maybeSingle();
  const row = data as ConnectionRow | null;
  if (!row?.refresh_token || !row.folder_id) return null;

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const stillValid = row.access_token && expiresAt - Date.now() > 60_000;
  if (stillValid) {
    return { accessToken: row.access_token as string, folderId: row.folder_id };
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number };

  const newExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  await admin
    .from("google_drive_connection")
    .update({ access_token: json.access_token, token_expires_at: newExpiresAt })
    .eq("id", 1);

  return { accessToken: json.access_token, folderId: row.folder_id };
}

export async function uploadFileToDrive(
  file: File,
  accessToken: string,
  folderId: string
): Promise<{ id: string; url: string } | { error: string }> {
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const uploadRes = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!uploadRes.ok) {
    return { error: `Google Drive upload failed: ${await uploadRes.text()}` };
  }
  const uploaded = (await uploadRes.json()) as { id: string };

  // Anyone at the company can already see any Supabase-stored file via a
  // plain URL today, so match that -- make the Drive file viewable by
  // anyone with the link rather than restricted to the connected account.
  await fetch(`${DRIVE_API}/files/${uploaded.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return { id: uploaded.id, url: `https://drive.google.com/file/d/${uploaded.id}/view` };
}

export async function deleteFileFromDrive(fileId: string, accessToken: string): Promise<void> {
  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
