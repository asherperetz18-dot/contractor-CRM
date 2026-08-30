"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    // Prefetching is on, and affordable now.
    //
    // It was turned off when a prefetch cost a full layout render on the
    // server -- around 552ms each, twelve of them queued in front of the
    // page actually clicked. Verifying the session locally rather than
    // asking the Auth API took most of that out: the same pages now
    // answer in roughly half the time, and a click without a prefetch
    // waits 290-800ms staring at the page it is leaving before even the
    // skeleton appears. That wait is worse than the background work.
    //
    // The real fix is a shell that does not need the server at all, at
    // which point a prefetch is a cacheable file rather than a render.
    // Until then this is the better of the two live options, and it is
    // one word to change back.
    <Link href={href} className={"nav-item" + (active ? " active" : "")}>
      {children}
    </Link>
  );
}
