import { DEFAULT_TIME_CLOCK_SETTINGS } from "@/lib/time-clock/settings";
import { LEGAL_UPDATED, PRIVACY_CONTACT_EMAIL } from "@/lib/app-store/legal";

export const metadata = { title: "Privacy policy — AI Build Pros CRM" };

/**
 * The privacy policy the Google Play and App Store listings link to.
 * Public (src/lib/public-paths.ts): reviewers and the public read it with
 * no account. Every claim here has to stay true of the product -- the
 * location default is read from the code for that reason.
 */
export default function PrivacyPage() {
  const retention = DEFAULT_TIME_CLOCK_SETTINGS.trail_retention_days;
  const mail = `mailto:${PRIVACY_CONTACT_EMAIL}`;

  return (
    <div className="legal-shell">
      <article className="legal-card">
        <h1 className="auth-title">Privacy policy</h1>
        <p className="legal-updated">AI Build Pros CRM · Last updated {LEGAL_UPDATED}</p>

        <h2>Who we are</h2>
        <p>
          AI Build Pros LLC makes the AI Build Pros CRM: the website at crm.aibuildpros.com and
          the phone app for Android and iPhone. Contracting companies use it to run their business:
          customers, estimates, jobs, schedules, and their crews&apos; hours. Questions about this
          policy go to <a href={mail}>{PRIVACY_CONTACT_EMAIL}</a>.
        </p>

        <h2>Whose data it is</h2>
        <p>
          Each company decides what goes into its CRM. We store and process that information for
          the company. If a contractor you hired holds information about you, ask that contractor
          first. We&apos;ll help them answer.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Your account:</strong> name, email, phone number, your role, and the company
            you work for.
          </li>
          <li>
            <strong>Location, only while you are clocked in.</strong> If your company tracks your
            role, the app records where you are every few minutes from clock-in to clock-out. That
            includes while the app is in the background or the phone is locked. On Android an
            &ldquo;On the clock&rdquo; notification shows the whole time. Nothing is recorded while
            you are clocked out.
          </li>
          <li>
            <strong>Hours:</strong> when and where you clock in and out.
          </li>
          <li>
            <strong>Work records you or your team enter:</strong> customers and their contact
            details, estimates, contracts and signatures, job photos, files, notes, and payments.
          </li>
          <li>
            <strong>Calls, texts, and email</strong> made through the CRM, including call
            recordings.
          </li>
          <li>
            <strong>How the CRM is used:</strong> which pages you open, how long you are active,
            and what kind of device you use. Your company&apos;s admins see this. We also receive
            error reports so we can fix problems.
          </li>
        </ul>

        <h2>How it is used</h2>
        <p>
          Only to run the CRM for your company: showing your team its work, the schedule, the team
          map and hours, and sending the calls, texts, and emails your company makes. We don&apos;t
          show ads. We don&apos;t sell personal information, and we don&apos;t share it for anyone
          else&apos;s marketing.
        </p>

        <h2>Who can see it</h2>
        <p>
          People in your company, depending on their role. Your location and hours are visible to
          your company&apos;s office and admins. We share information with the services that run
          parts of the CRM for us, and only so they can do that job:
        </p>
        <ul>
          <li>Supabase (database and sign-in) and Vercel (hosting)</li>
          <li>Twilio and CallRail (calls and texts), and Resend (email)</li>
          <li>Stripe (payments; we never see or store full card numbers)</li>
          <li>Google (maps, plus Drive and Calendar if your company connects them)</li>
          <li>Meta (Facebook lead forms, if your company connects them)</li>
          <li>PropertyRadar (property details for an address)</li>
          <li>Anthropic (the CRM&apos;s AI features)</li>
          <li>Sentry (error reports)</li>
        </ul>
        <p>We may also disclose information if the law requires it.</p>

        <h2>How long it is kept</h2>
        <p>
          Location trails are deleted automatically after the period your company sets. The
          default is {retention} days. Everything else is kept while your company uses the CRM,
          or until your company or you ask for it to be deleted.
        </p>

        <h2>Security</h2>
        <p>
          Everything travels encrypted (HTTPS). Who can read what is enforced by the database
          itself, by company and role, not only by what the screens show.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>
            You can turn off location for the app at any time in your phone&apos;s settings. Your
            company may require it while you are on the clock.
          </li>
          <li>
            To see, correct, or delete your information, ask your company&apos;s admin or email us.
            To delete your account, see{" "}
            <a href="/delete-account">Delete your account</a>.
          </li>
        </ul>

        <h2>Children</h2>
        <p>The CRM is a work tool for adults and is not meant for anyone under 18.</p>

        <h2>Changes</h2>
        <p>
          When this policy changes, the date at the top changes. Big changes will be announced in
          the CRM.
        </p>

        <p className="legal-contact">
          AI Build Pros LLC · <a href={mail}>{PRIVACY_CONTACT_EMAIL}</a>
        </p>
      </article>
      <footer className="site-footer">© 2026 AI Build Pros LLC. All rights reserved.</footer>
    </div>
  );
}
