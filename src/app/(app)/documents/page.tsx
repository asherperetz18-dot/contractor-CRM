import { redirect } from "next/navigation";

// The module moved to /estimates when it stopped being a placeholder.
// Kept as a redirect so old links and bookmarks still land somewhere.
export default function DocumentsPage() {
  redirect("/estimates");
}
