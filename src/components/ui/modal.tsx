"use client";

import { useEffect, useRef } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide,
  xwide,
  drawer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
  /** Full-height panel docked to the right edge, so what's behind stays
   *  readable — review flows peek at a record and move on. */
  drawer?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // The page behind must not scroll while a modal is open. Without the
  // lock, a wheel gesture over the backdrop moved the page underneath
  // and the card stayed put -- which reads as "scrolling is broken"
  // until the cursor happens to drift onto the card.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className={"modal-backdrop" + (drawer ? " modal-backdrop-drawer" : "")}
      onClick={onClose}
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
