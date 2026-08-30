/**
 * Shown while a page's server work finishes, and the reason prefetching
 * is affordable.
 *
 * Two things were wrong without it.
 *
 * Clicking a link left the previous page on screen, frozen, until the
 * server had finished everything -- no spinner, no shell, no sign the
 * click had registered. People clicked again.
 *
 * The larger one: Next prefetches every <Link> that is on screen, and
 * for a dynamic route it prefetches "down to the nearest segment with a
 * loading boundary". There was no boundary anywhere in the app, so
 * there was nothing to stop at and each prefetch rendered the whole
 * page instead -- every query it makes, on the server. The sidebar
 * shows a dozen links at once, several of them the heaviest pages in
 * the app, so simply arriving anywhere queued a dozen full page renders
 * the browser then threw away. Measured on the schedule page: prefetch
 * requests for /projects, /estimates, /calendar, /production,
 * /marketing-analytics and / , around 870ms of server time each,
 * queued ahead of the page actually being asked for.
 *
 * One boundary at the group level covers every route inside it, so
 * prefetch now stops here and costs almost nothing, and the head start
 * on a click is kept rather than switched off.
 */
export default function Loading() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="module-toolbar">
        <div>
          <div className="sk sk-title" />
          <div className="sk sk-sub" />
        </div>
        <div className="sk sk-action" />
      </div>
      <div className="sk-panel">
        {/* Deliberately a plain block rather than a guess at each page's
            layout: one boundary serves sixty-odd pages, and a skeleton
            that mimics the wrong page reads worse than one that clearly
            stands for "not here yet". */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div className="sk sk-row" key={i} />
        ))}
      </div>
    </div>
  );
}
