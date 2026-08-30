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
    // prefetch={false}: the sidebar shows a dozen links at once, and Next
    // prefetches every one that is on screen. Even stopping at the
    // loading boundary each of those costs a layout render on the server
    // -- measured at ~552ms apiece, six of them, every time anyone
    // arrives on any page. That is several seconds of server work spent
    // on pages nobody opened, and it queues in front of the page they
    // did. A click without a head start is far cheaper than paying for
    // twelve head starts nobody used.
    <Link
      href={href}
      prefetch={false}
      className={"nav-item" + (active ? " active" : "")}
    >
      {children}
    </Link>
  );
}
