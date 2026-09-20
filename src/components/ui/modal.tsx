"use client";

import { useEffect, useRef } from "react";

let bodyScrollLocks = 0;

// Exported for the file-preview lightbox, which opens on top of modals
// (job photos live in one): both must share the one counter, or
// whichever closes second hands the scroll back while the other is
// still up.
export function lockBodyScroll() {
  bodyScrollLocks += 1;
  document.body.style.overflow = "hidden";
}

export function unlockBodyScroll() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) document.body.style.overflow = "";
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  xwide,
  drawer,
  noBackdropClose,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
  /** Full-height panel docked to the right edge, so what's behind stays
   *  readable — review flows peek at a record and move on. */
  drawer?: boolean;
  /** A click on the dark backdrop normally closes the modal. For a
   *  prompt that must be answered on purpose (an incoming invite), set
   *  this so only the ✕ or an explicit button dismisses it — a stray
   *  click on the page behind shouldn't eat the question. */
  noBackdropClose?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // The page behind must not scroll while a modal is open. Without the
  // lock, a wheel gesture over the backdrop moved the page underneath
  // and the card stayed put -- which reads as "scrolling is broken"
  // until the cursor happens to drift onto the card.
  //
  // Counted, not saved-and-restored: with two modals up at once (a
  // confirm on top of a drawer), whichever closed last used to restore
  // the overflow it saw at mount -- "hidden", left on the body for
  // good, a page that can't scroll and reads exactly like a freeze.
  useEffect(() => {
    lockBodyScroll();
    return unlockBodyScroll;
  }, []);

  return (
    <div
      className={"modal-backdrop" + (drawer ? " modal-backdrop-drawer" : "")}
      onClick={noBackdropClose ? undefined : onClose}
      // Wheel over the dark ring scrolls the card anyway: when a modal
      // is open, the card is the only thing scrolling means.
      onWheel={(e) => {
        if (e.target === e.currentTarget) {
          panelRef.current?.scrollBy({ top: e.deltaY });
        }
      }}
    >
      <div
        ref={panelRef}
        className={
          "modal" +
          (xwide ? " modal-xwide" : wide ? " modal-wide" : "") +
          (drawer ? " modal-drawer" : "")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
