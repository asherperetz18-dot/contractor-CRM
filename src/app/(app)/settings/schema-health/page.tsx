import { AdminGate } from "@/components/admin-gate";
import { checkSchemaDrift } from "@/lib/actions/schema-health";

// Always probes the live database -- a cached "all good" from before a
// deploy is the one answer this page must never give.
export const dynamic = "force-dynamic";

/**
 * Is the live database up to date with the deployed code?
 *
 * Code deploys automatically on merge, but each SQL migration is run by
 * hand in the Supabase SQL editor -- and a skipped one breaks every
 * write to its table (see docs/DECISIONS.md #018). This page probes for
 * the columns recent migrations add and, for anything absent, names the
 * exact file in supabase/migrations/ to paste and run.
 */
export default async function SchemaHealthPage() {
  const report = await checkSchemaDrift();

  return (
    <AdminGate adminOnly>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Database Health</h1>
          <p className="module-sub">
            Checks that every database update shipped with the app has actually been run
          </p>
        </div>
      </div>

      {!report ? (
        <div className="empty-state">
          <p className="empty-label">Could not run the check</p>
          <p className="empty-hint">Sign in with an Admin account and reload.</p>
        </div>
      ) : report.ok ? (
        <div className="empty-state">
          <p className="empty-mark">✓</p>
          <p className="empty-label">Database is up to date</p>
          <p className="empty-hint">
            All {report.checked} expected columns are present. Nothing to run.
          </p>
        </div>
      ) : (
        <>
          {report.missing.length > 0 && (
            <>
              <p className="error-note">
                {report.missing.length === 1
                  ? "1 database update has not been run."
                  : `${report.missing.length} database updates have not been run.`}{" "}
                Open each file below from <code>supabase/migrations/</code> in the repo, paste
                its contents into the Supabase SQL editor, and run it. Until then, saving to
                the affected tables fails for everyone.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File to run</th>
                    <th>Missing columns</th>
                  </tr>
                </thead>
                <tbody>
                  {report.missing.map((m) => (
                    <tr key={m.migration}>
                      <td>
                        <code>{m.migration}</code>
                      </td>
                      <td>{m.columns.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.failed.length > 0 && (
            <div className="empty-state">
              <p className="empty-label">
                {report.failed.length === 1
                  ? "1 check could not run"
                  : `${report.failed.length} checks could not run`}
              </p>
              <p className="empty-hint">
                Not a missing update — the probe itself failed. Reload to retry.
              </p>
              {report.failed.map((f) => (
                <p key={f.column} className="empty-hint">
                  <code>{f.column}</code> — {f.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </AdminGate>
  );
}
