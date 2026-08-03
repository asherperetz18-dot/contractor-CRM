"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerPortalChallenge } from "@/lib/actions/portal";

export function PortalChallengeForm() {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await answerPortalChallenge(answer);
      if (result?.error) {
        setError(result.error);
        setRemaining(result.remaining ?? null);
        return;
      }
      router.push("/portal/home");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="portal-auth-wrap">
      <div className="portal-auth-card">
        <h1 className="portal-auth-title">Confirm it&apos;s you</h1>
        {/* The example is deliberately fictional. Using a real customer's
            address here would print the answer on the page for them. */}
        <p className="portal-auth-sub">
          For your security, enter the street number of your project address — just the number, for
          example <strong>1234</strong> for 1234 Main St.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="portal-auth-label" htmlFor="portal-street">
            Street number
          </label>
          <input
            id="portal-street"
            inputMode="numeric"
            autoComplete="off"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="5555"
            required
            autoFocus
          />
          {error && (
            <p className="error-note">
              {error}
              {remaining !== null && remaining > 0 && (
                <> {remaining} attempt{remaining === 1 ? "" : "s"} left.</>
              )}
            </p>
          )}
          <button type="submit" className="btn-primary portal-auth-submit" disabled={pending}>
            {pending ? "Checking…" : "Open my portal"}
          </button>
        </form>
      </div>
    </div>
  );
}
