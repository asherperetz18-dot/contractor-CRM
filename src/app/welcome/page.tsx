import { provisionSignup } from "@/lib/signup/provision";
import { INVITE_TTL_DAYS } from "@/lib/signup/invites";

export const metadata = { title: "Thanks for signing up" };

// Never cached: the answer depends on a Stripe session id in the URL and
// on work this page performs.
export const dynamic = "force-dynamic";

/**
 * Where Stripe returns the customer after payment.
 *
 * Stripe recommends triggering fulfilment here as well as from the
 * webhook -- "webhooks can sometimes be delayed. To optimize your payment
 * flow and guarantee immediate fulfillment when your customer is present,
 * trigger fulfillment from your landing page as well." Whichever gets
 * there first sends the email; the other is a no-op, enforced by the
 * unique stripe_session_id column.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  const result = await provisionSignup(sessionId ?? "");

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {/* The heading belongs inside the branch, not above it. Outside, a
            visitor who lands here with no session id -- or whose bank
            debit has not cleared -- is congratulated on a payment that
            hasn't happened. */}
        {result.ok ? (
          <>
            <h1 className="auth-title">Thanks — you&apos;re paid up</h1>
            <p className="auth-sub">
              We&apos;ve emailed a setup link to <strong>{result.email}</strong>. Open it
              to pick a password, and {result.companyName} is ready to use.
            </p>
            <p className="hint-note">
              The link works once and expires in {INVITE_TTL_DAYS} days. Check spam
              if it hasn&apos;t arrived in a few minutes.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Not quite there yet</h1>
            <p className="auth-sub">{result.error}</p>
            <p className="hint-note">
              If money did leave your account, it&apos;s safe. Get in touch and
              we&apos;ll finish the setup for you.
            </p>
          </>
        )}
        <p className="auth-switch" style={{ marginTop: 8 }}>
          <a href="/login">Go to sign in</a>
        </p>
      </div>
    </div>
  );
}
