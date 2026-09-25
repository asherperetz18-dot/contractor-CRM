/**
 * The Drive call that moves a file to the trash. A DELETE on the file
 * skips the trash and is gone for good; the trash keeps it 30 days,
 * so a photo deleted in the CRM by mistake can be restored from Drive.
 */
export function driveTrashRequest(
  fileId: string,
  accessToken: string
): { url: string; init: RequestInit } {
  return {
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    init: {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  };
}
