"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerPortalChallenge } from "@/lib/actions/portal";

export function PortalChallengeForm({
  companyName,
  logoUrl,
  next,
}: {
  companyName: string;
  logoUrl: string | null;
  // Where to land once the address challenge passes. An estimate link
  // points at its own document instead of the portal home.
  next: string;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setPending(true);
    setError("");
    try {
      const result = await answerPortalChallenge(answer);
      if (result?.error) {
        setError(result.error);
        setRemaining(result.remaining ?? null);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="portal-gate">
      <div className="portal-gate-card">
        <div className="portal-gate-accent" aria-hidden="true" />
        <div className="portal-gate-body">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="portal-gate-logo" />
          )}
          <h1 className="portal-gate-title">{companyName}</h1>
          <p className="portal-gate-sub">Please enter your passcode to access the portal</p>

          <form onSubmit={handleSubmit}>
            <label className="portal-gate-label" htmlFor="portal-passcode">
              Passcode
            </label>
            {/* The example is deliberately generic -- naming a real
                address here would print someone's answer on their screen. */}
            <p className="portal-gate-hint">Enter your house number from the project address</p>

            <div className="portal-gate-input-wrap">
              <input
                id="portal-passcode"
                type={reveal ? "text" : "password"}
                inputMode="numeric"
                autoComplete="off"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                required
                autoFocus
              />
              <button
                type="button"
                className="portal-gate-reveal"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide passcode" : "Show passcode"}
                title={reveal ? "Hide passcode" : "Show passcode"}
              >
                {reveal ? "🙈" : "👁"}
              </button>
            </div>

            {error && (
              <p className="portal-gate-error">
                {error}
                {remaining !== null && remaining > 0 && (
                  <> {remaining} attempt{remaining === 1 ? "" : "s"} left.</>
                )}
              </p>
            )}

            <button
              type="submit"
              className="portal-gate-submit"
              disabled={pending || !answer.trim()}
            >
              <span aria-hidden="true">🔒</span> {pending ? "Checking…" : "Access Portal"}
            </button>
          </form>

          <p className="portal-gate-foot">
            Your passcode is the house number from your project address.
            <br />
            If you&apos;re having trouble, please contact us.
          </p>
        </div>
      </div>
    </div>
  );
}
