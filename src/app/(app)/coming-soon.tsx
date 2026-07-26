export function ComingSoon({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">{title}</h1>
          <p className="module-sub">{subtitle}</p>
        </div>
      </div>
      <div className="empty-state">
        <div className="empty-mark" aria-hidden="true">
          ＋
        </div>
        <p className="empty-label">Coming soon</p>
        <p className="empty-hint">
          This module is being built out next, wired to the same live
          database as the rest of the app.
        </p>
      </div>
    </>
  );
}
