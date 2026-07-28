"use client";

export function MobileNavToggle() {
  return (
    <button
      type="button"
      className="mobile-nav-toggle"
      onClick={() => window.dispatchEvent(new CustomEvent("crm:mobile-nav-toggle"))}
      aria-label="Open menu"
    >
      ☰
    </button>
  );
}
