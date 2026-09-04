import { GetStartedForm } from "./get-started-form";
import { signupConfigured } from "@/lib/signup/provision";

export const metadata = { title: "Get started — Contractor CRM" };

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
