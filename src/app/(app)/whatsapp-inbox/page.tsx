import { getCurrentProfile } from "@/lib/data/profile";
import { canEditChecklists } from "@/lib/data/types";
import { WhatsAppInboxView } from "./whatsapp-inbox-view";

export const dynamic = "force-dynamic";

/**
 * Photos and receipts from the company's general WhatsApp groups, each
 * waiting to be filed to a job, made into a bill or dismissed
 * (DECISIONS #204). The office and production sort it; its actions check
 * the same on the server.
 */
export default async function WhatsAppInboxPage() {
  const profile = await getCurrentProfile();
  if (!canEditChecklists(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">WhatsApp Inbox</p>
        <p className="empty-hint">The WhatsApp Inbox is for Office, Admin and Production users.</p>
      </div>
    );
  }
  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">WhatsApp Inbox</h1>
          <p className="module-sub">
            Photos and receipts from your general WhatsApp groups — file each one to a job, make it a bill, or
            dismiss it
          </p>
        </div>
      </div>
      <WhatsAppInboxView />
    </>
  );
}
