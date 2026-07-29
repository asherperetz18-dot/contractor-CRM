import Link from "next/link";

export type MobileModule = { label: string; href: string; icon: string };

type MonthCell = { day: number; dateStr: string; count: number; isToday: boolean };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTalkTime(totalSeconds: number) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

export function MobileDashboard({
  openTasksCount,
  overdueTasksCount,
  callActivity,
  weekCounts,
  monthLabel,
  monthLeadingBlanks,
  monthCells,
  modules,
}: {
  openTasksCount: number;
  overdueTasksCount: number;
  callActivity: { dials: number; connected: number; talkTimeSeconds: number; sales: number };
  weekCounts: number[];
  monthLabel: string;
  monthLeadingBlanks: number;
  monthCells: MonthCell[];
  modules: MobileModule[];
}) {
  const maxWeekCount = Math.max(1, ...weekCounts);

  return (
    <div className="dash-mobile">
      <div className="mobile-widget">
        <h3 className="mobile-widget-title">My Tasks</h3>
        <div className="mobile-stat-row">
          <div className="mobile-stat">
            <div className="mobile-stat-value">{openTasksCount}</div>
            <div className="mobile-stat-label">Open</div>
          </div>
          <div className="mobile-stat">
            <div className="mobile-stat-value mobile-stat-danger">{overdueTasksCount}</div>
            <div className="mobile-stat-label">Overdue</div>
          </div>
        </div>
      </div>

      <div className="mobile-widget">
        <h3 className="mobile-widget-title">Call Activity — Last 48 Hours</h3>
        <div className="mobile-stat-row">
          <div className="mobile-stat">
            <div className="mobile-stat-value">{callActivity.dials}</div>
            <div className="mobile-stat-label">Dials</div>
          </div>
          <div className="mobile-stat">
            <div className="mobile-stat-value">{callActivity.connected}</div>
            <div className="mobile-stat-label">Connected</div>
          </div>
          <div className="mobile-stat">
            <div className="mobile-stat-value">{formatTalkTime(callActivity.talkTimeSeconds)}</div>
            <div className="mobile-stat-label">Talk time</div>
          </div>
          <div className="mobile-stat">
            <div className="mobile-stat-value">{callActivity.sales}</div>
            <div className="mobile-stat-label">Sales</div>
          </div>
        </div>
      </div>

      <div className="mobile-widget">
        <h3 className="mobile-widget-title">Appointments This Week</h3>
        <div className="week-chart">
          {weekCounts.map((count, i) => (
            <div className="week-bar-col" key={i}>
              <div className="week-bar-track">
                <div
                  className="week-bar"
                  style={{ height: `${(count / maxWeekCount) * 100}%` }}
                  title={`${count} appointment${count === 1 ? "" : "s"}`}
                />
              </div>
              <div className="week-bar-count">{count}</div>
              <div className="week-bar-label">{WEEKDAY_LABELS[i]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mobile-widget">
        <h3 className="mobile-widget-title">{monthLabel}</h3>
        <div className="month-cal">
          {WEEKDAY_LABELS.map((label) => (
            <div className="month-cal-head" key={label}>
              {label[0]}
            </div>
          ))}
          {Array.from({ length: monthLeadingBlanks }, (_, i) => (
            <div className="month-cal-cell month-cal-blank" key={`blank-${i}`} />
          ))}
          {monthCells.map((cell) => (
            <div
              className={"month-cal-cell" + (cell.isToday ? " month-cal-today" : "")}
              key={cell.dateStr}
            >
              <span className="month-cal-day">{cell.day}</span>
              {cell.count > 0 && <span className="month-cal-badge">{cell.count}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="mobile-widget">
        <h3 className="mobile-widget-title">Modules</h3>
        <div className="modules-grid">
          {modules.map((m) => (
            <Link href={m.href} className="module-tile" key={m.href}>
              <span className="module-tile-icon">{m.icon}</span>
              <span className="module-tile-label">{m.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
