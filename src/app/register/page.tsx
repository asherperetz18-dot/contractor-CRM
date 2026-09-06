import { loadUsableInvite } from "@/lib/signup/invites";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Set up your account" };

// The token is checked on every load, so this can never be cached.
export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const { invite, error } = await loadUsableInvite(token ?? "");

  // The link is checked before the form is drawn, so an expired or spent
  // one says so instead of collecting a password it will then reject.
  if (!invite) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Set up your account</h1>
          <p className="auth-sub">{error}</p>
          <p className="auth-switch">
            <a href="/login">Go to sign in</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <RegisterForm
      token={token ?? ""}
      companyName={invite.company_name}
      email={invite.email}
    />
  );
}
