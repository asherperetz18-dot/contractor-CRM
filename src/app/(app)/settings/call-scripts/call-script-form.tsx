"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveCallScript } from "@/lib/actions/settings";

export function CallScriptForm({ initialScript }: { initialScript: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [script, setScript] = useState(initialScript);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setSaved(false);
    const result = await saveCallScript(script);
    setPending(false);
    if (!result.error) {
      setSaved(true);
      startTransition(() => router.refresh());
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Call Scripts</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Call Scripts</h1>
          <p className="module-sub">
            Shown to reps in the Power Dialer while a call is connecting or connected
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">📝 Script</div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.5 }}
          placeholder={`Hi [Name], this is [Rep] with [Company]. I'm calling about...`}
        />
        <div className="modal-actions">
          <div />
          <div>
            {saved && <span className="hint-note" style={{ marginRight: 10 }}>Saved</span>}
            <button className="btn-primary" onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save Script"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
