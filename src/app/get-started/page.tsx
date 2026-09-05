import { GetStartedForm } from "./get-started-form";
import { signupConfigured } from "@/lib/signup/provision";

export const metadata = { title: "Get started — Contractor CRM" };

// Whether there is anything to sell is read from the environment, and
// this page uses no other dynamic API -- so without this Next prerenders
// it and the answer is frozen into the build's static HTML.
//
// On Vercel an env var change needs a redeploy anyway, so this is not
// about the dashboard taking effect instantly. It is about the page and
// the button never disagreeing: a stale prerender offering a checkout
// the action refuses, or refusing one the action would have honoured, is
// worse than one server render on a page nobody hits in a loop.
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
