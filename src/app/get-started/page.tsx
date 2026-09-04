import { GetStartedForm } from "./get-started-form";
import { signupConfigured } from "@/lib/signup/provision";

export const metadata = { title: "Get started — Contractor CRM" };

// Whether there is anything to sell is read from the environment, and this
// page uses no other dynamic API -- so without this it is prerendered at
// build time and the answer is frozen into static HTML. Setting
// SIGNUP_PRICE_ID in the hosting dashboard would then change nothing until
// somebody happened to redeploy: the page would keep serving "signing up
// isn't open yet" to every visitor.
export const dynamic = "force-dynamic";

export default function GetStartedPage() {
  // No Stripe key or no plan configured means there is nothing to sell.
  // Saying so beats a checkout button that fails on click.
  if (!signupConfigured()) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Contractor CRM</h1>
          <p className="auth-sub">
            Signing up online isn&apos;t open yet. Get in touch and we&apos;ll set your
            company up for you.
          </p>
          <p className="auth-switch">
            <a href="/login">Back to sign in</a>
          </p>
        </div>
      </div>
    );
  }
  return <GetStartedForm />;
}
