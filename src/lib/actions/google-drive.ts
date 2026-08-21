"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

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
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage cloud storage." };
  return {};
}

export async function getGoogleDriveStatus(): Promise<{
  connected: boolean;
  email?: string;
  /** The row exists but Google refuses the token -- reconnect needed. */
  expired?: boolean;
}> {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { connected: false };

  const admin = createAdminClient();
  const { data } = await admin
    .from("google_drive_connection")
    .select("connected_email")
    .eq("company_id", companyId)
    .maybeSingle();
  const row = data as { connected_email: string | null } | null;
  if (!row?.connected_email) return { connected: false };

  // "Connected" is a claim about NOW, not about a row that was written
  // once. Google expires refresh tokens (seven days flat while the
  // OAuth app sits in Testing mode), and this page kept showing a green
  // badge for weeks after every upload had quietly stopped reaching
  // Drive. Prove the token still refreshes before saying so.
  const live = await getValidAccessToken(companyId);
  if (!live) return { connected: true, email: row.connected_email, expired: true };
  return { connected: true, email: row.connected_email };
}

export async function disconnectGoogleDrive(): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const admin = createAdminClient();
  await admin.from("google_drive_connection").delete().eq("company_id", companyId);

  revalidatePath("/settings/cloud-storage");
  return {};
}

// Returns a live access token, refreshing it first if it's expired or
// about to be. Returns null if Drive isn't connected at all.
export async function getValidAccessToken(companyId: string): Promise<{
  accessToken: string;
  folderId: string;
} | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_drive_connection")
    .select("access_token, refresh_token, token_expires_at, folder_id")
    .eq("company_id", companyId)
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
    .eq("company_id", companyId);

  return { accessToken: json.access_token, folderId: row.folder_id };
}

// Returns the Drive subfolder for this lead's attachments, creating it
// (under the root "Contractor CRM Files" folder) the first time a file
// is uploaded for that contact.
export async function getOrCreateLeadDriveFolder(
  leadId: string,
  companyId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("drive_folder_id, contact_type, company_name, first_name, last_name")
    .eq("id", leadId)
    .single();
  const lead = data as {
    drive_folder_id: string | null;
    contact_type: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  if (!lead) return null;
  if (lead.drive_folder_id) return lead.drive_folder_id;

  const drive = await getValidAccessToken(companyId);
  if (!drive) return null;

  const displayName =
    lead.contact_type === "Company"
      ? lead.company_name || "Unnamed Company"
      : `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed Lead";
  const folderName = `${displayName} (${leadId.slice(0, 8)})`;

  const folderRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${drive.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [drive.folderId],
    }),
  });
  if (!folderRes.ok) return null;
  const folder = (await folderRes.json()) as { id: string };

  await admin.from("leads").update({ drive_folder_id: folder.id }).eq("id", leadId);
  return folder.id;
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

/**
 * Upload bytes the server already holds, via Drive's resumable
 * protocol: one metadata POST for a session URL, one PUT with the
 * whole body. Multipart caps at ~5MB; this has no such ceiling, which
 * is what lets the direct-to-storage upload path hand its files to
 * Drive afterwards regardless of size.
 */
export async function uploadBlobToDrive(
  name: string,
  blob: Blob,
  contentType: string,
  accessToken: string,
  folderId: string
): Promise<{ id: string; url: string } | { error: string }> {
  const start = await fetch(`${DRIVE_UPLOAD_API}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": contentType || "application/octet-stream",
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const sessionUrl = start.headers.get("location");
  if (!start.ok || !sessionUrl) {
    return { error: `Google Drive upload failed: ${await start.text()}` };
  }

  const put = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType || "application/octet-stream" },
    body: blob,
  });
  if (!put.ok) {
    return { error: `Google Drive upload failed: ${await put.text()}` };
  }
  const uploaded = (await put.json()) as { id: string };

  // Same visibility as a Supabase-stored file: anyone with the link.
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
