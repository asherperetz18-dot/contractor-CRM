"use client";

import { useEffect, useRef } from "react";

/**
 * Print / Save as PDF.
 *
 * Deliberately the browser's own print dialog rather than a server-side
 * PDF renderer: every browser's print dialog already offers "Save as PDF"
 * (and "Microsoft Print to PDF" on Windows), it prints the exact document
 * on screen rather than a second template that could drift from it, and
 * it needs no extra dependency, font bundling or server memory.
 *
 * The print stylesheet in globals.css is what makes the output a clean
 * document -- without it the app shell clips the page.
 *
 * `title` is the file name. Every browser names a saved PDF after
 * document.title, so a document page passes its number ("EST-1048") and
 * the dialog suggests EST-1048.pdf instead of Contractor_CRM.pdf. The
 * page also sets the same title through its metadata; writing it here
 * too, right before the dialog opens, means the file name never depends
 * on whether that streamed-in title has landed yet.
 */
export function PrintButton({
  label = "Print / Save as PDF",
  title,
}: {
  label?: string;
  title?: string;
}) {
  return (
    <button className="btn-ghost estdoc-print-btn" onClick={() => printPage(title)}>
      {label}
    </button>
  );
}

/**
 * Opens the print dialog once on arrival, for the Print button on the
 * builder: that page is the editor, so printing it would print form
 * fields. It routes here (the real document) with ?print=1 instead, and
 * this fires the dialog so the rep still only clicks once.
 */
export function AutoPrint({ enabled, title }: { enabled: boolean; title?: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || fired.current) return;
    fired.current = true;
    // One frame, so the document has painted before the dialog snapshots
    // it -- printing an unpainted page yields a blank sheet.
    const id = requestAnimationFrame(() => printPage(title));
    return () => cancelAnimationFrame(id);
  }, [enabled, title]);

  return null;
}

function printPage(title?: string) {
  if (title) document.title = title;
  window.print();
}
