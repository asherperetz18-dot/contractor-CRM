"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";

/**
 * A sidebar link that fetches itself when you are about to click it.
 *
 * Next prefetches every <Link> that is on screen. The whole sidebar is
 * on screen, so arriving anywhere queued a dozen of them, and a trace of
 * one click on Estimates showed the page actually asked for -- the very
 * first request -- still unfinished while eight prefetches and three
 * background actions went ahead of it. The prefetches were not making
 * the click faster; they were standing in front of it.
 *
 * Turning prefetching off instead left a click sitting on the old page
 * for 290-800ms before even a skeleton appeared, because the router has
 * to reach the server before it can show anything.
 *
 * Neither is a good answer, and the reason is that both were choosing
 * how many pages to fetch rather than which. A pointer lands on a link a
 * few hundred milliseconds before it clicks, and a keyboard focus lands
 * earlier than that, so that moment is when the one page worth fetching
 * becomes known. One request, for the page you are actually going to.
 *
 * Done once per link: router.prefetch is not free and hovering back and
 * forth across a menu should not re-issue it.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const asked = useRef(false);
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  function warm() {
    if (asked.current || href === pathname) return;
    asked.current = true;
    router.prefetch(href);
  }

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      className={"nav-item" + (active ? " active" : "")}
    >
      {children}
    </Link>
  );
}
