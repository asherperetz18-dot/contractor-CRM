import { DELETION_DAYS, LEGAL_UPDATED, PRIVACY_CONTACT_EMAIL } from "@/lib/app-store/legal";

export const metadata = { title: "Delete your account — AI Build Pros CRM" };

/**
 * The account-deletion page Google Play requires of any app with
 * accounts, linked from the store listing, the sign-in page and the
 * sidebar. Public (src/lib/public-paths.ts).
 */
export default function DeleteAccountPage() {
  const subject = encodeURIComponent("Delete my account");
  const mail = `mailto:${PRIVACY_CONTACT_EMAIL}?subject=${subject}`;

  return (
    <div className="legal-shell">
      <article className="legal-card">
        <h1 className="auth-title">Delete your account</h1>
        <p className="legal-updated">AI Build Pros CRM · Last updated {LEGAL_UPDATED}</p>

        <h2>How to ask</h2>
        <ol>
          <li>
            Email <a href={mail}>{PRIVACY_CONTACT_EMAIL}</a> from the email address you sign in
            with, with the subject &ldquo;Delete my account&rdquo;.
          </li>
          <li>Say which company you work for.</li>
          <li>
            We reply to confirm, and delete the account within {DELETION_DAYS} days. If the email
            doesn&apos;t come from your sign-in address, we may ask you to confirm it&apos;s you.
          </li>
        </ol>

        <h2>What is deleted</h2>
        <ul>
          <li>Your sign-in, so the account can no longer be used.</li>
          <li>Your profile: name and phone number.</li>
          <li>Your location trail.</li>
        </ul>

        <h2>What stays with your company</h2>
        <p>
          Work records belong to the company you worked for, and they may need to keep them for
          payroll, tax, or legal reasons. That covers the hours you worked, jobs, estimates, and
          notes you wrote, and customer records. They stay in that company&apos;s CRM until the
          company deletes them.
        </p>

        <h2>Deleting a whole company</h2>
        <p>
          If you own the company and want all of its data deleted, say so in the email. We confirm
          with the company&apos;s owner before deleting anything.
        </p>

        <h2>If a contractor holds your information</h2>
        <p>
          If you are a customer of a contractor that uses this CRM, ask that contractor to delete
          your information, or email us and we&apos;ll pass the request on.
        </p>

        <p className="legal-contact">
          <a href="/privacy">Privacy policy</a> · AI Build Pros LLC
        </p>
      </article>
      <footer className="site-footer">© 2026 AI Build Pros LLC. All rights reserved.</footer>
    </div>
  );
}
