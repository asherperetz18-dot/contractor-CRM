import { money, type Lead, type Profile } from "@/lib/data/types";

const MEDALS = ["🏆", "🥈", "🥉"];

function initials(name: string | null, email: string | null) {
  const source = (name || email || "?").trim();
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function SalespeopleGrid({
  reps,
  leads,
}: {
  reps: Profile[];
  leads: Lead[];
}) {
  // Sales role only. This page ranks selling performance, so an Admin or
  // Office account sitting in it with zeroes reads as a rep who has sold
  // nothing rather than as someone who was never selling.
  const activeReps = reps.filter(
    (r) => r.status === "Active" && r.roles.includes("Sales")
  );

  const stats = activeReps
    .map((rep) => {
      const assigned = leads.filter((l) => l.assigned_to === rep.id);
      const open = assigned.filter((l) => !["Won", "Lost", "DNC"].includes(l.stage));
      const won = assigned.filter((l) => l.stage === "Won");
      const wonValue = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
      return { rep, assignedCount: assigned.length, openCount: open.length, wonCount: won.length, wonValue };
    })
    .sort((a, b) => b.wonValue - a.wonValue);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Salespeople</h1>
          <p className="module-sub">{activeReps.length} with the Sales role</p>
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No active salespeople yet</p>
          <p className="empty-hint">
            Add users and give them a role from Admin Settings &rarr; Users &amp; Roles.
          </p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Rep</th>
              <th>Roles</th>
              <th className="right">Assigned Leads</th>
              <th className="right">Open</th>
              <th className="right">Won</th>
              <th className="right">Won Value</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(({ rep, assignedCount, openCount, wonCount, wonValue }, i) => (
              <tr key={rep.id}>
                <td style={{ width: 28 }}>{MEDALS[i] ?? ""}</td>
                <td>
                  <div className="ur-name-cell">
                    <span className="ur-avatar">{initials(rep.name, rep.email)}</span>
                    <div>
                      <div className="ur-name">{rep.name || rep.email}</div>
                      <div className="ur-add-phone">{rep.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="ur-role-badges">
                    {rep.roles.map((r) => (
                      <span
                        key={r}
                        className={"role-badge " + (r === "Office" ? "role-office" : "role-field")}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="right mono">{assignedCount}</td>
                <td className="right mono">{openCount}</td>
                <td className="right mono">{wonCount}</td>
                <td className="right mono">{money(wonValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
