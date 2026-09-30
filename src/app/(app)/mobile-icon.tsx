import type { MobileIconName } from "@/lib/mobile-tabs";

/** Icons the phone layout draws beyond the page icons: the More tab, the
 *  sheet's close button, the tools and the account row. */
export type ChromeIconName =
  | "more"
  | "close"
  | "signout"
  | "video"
  | "screen"
  | "eye"
  | "online"
  | "sun"
  | "spark"
  | "tools"
  | "chevron"
  | "navigate"
  | "plus";

// Line icons on a 24px grid, drawn in currentColor so the tab or tile
// they sit on decides their color.
const PATHS: Record<MobileIconName | ChromeIconName, string[]> = {
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M9.5 21v-6h5v6"],
  gauge: ["M4 18a8 8 0 1 1 16 0", "M12 18l4-6"],
  chart: ["M4 20V4", "M4 20h16", "m7 15 4-5 3 3 5-6"],
  leads: [
    "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5",
    "M16 4.6a3.5 3.5 0 0 1 0 6.8",
    "M18.5 14.8c1.6.8 2.6 2.5 3 5.2",
  ],
  tasks: ["M9 6h11M9 12h11M9 18h11", "m3.5 6 1.5 1.5L7.5 5", "m3.5 12 1.5 1.5L7.5 11", "m3.5 18 1.5 1.5L7.5 17"],
  inbox: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v6H3v-6z"],
  contacts: ["M5 3h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5z", "M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M8 17c.6-2 2.1-3 4-3s3.4 1 4 3", "M3 7h2M3 12h2M3 17h2"],
  assign: ["M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M2.5 19c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5", "M15 12h6", "m18 9 3 3-3 3"],
  refund: ["M4 9h11a5 5 0 0 1 0 10H9", "M8 5 4 9l4 4"],
  dialer: ["M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6.5 6.5l1.5-2.3 4.5 1.8v3.5a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z"],
  calls: ["M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6.5 6.5l1.5-2.3 4.5 1.8v3.5a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z", "M15 3.5a5.5 5.5 0 0 1 5.5 5.5"],
  texts: ["M4 5h16v11H9l-5 4z", "M8 9.5h8M8 12.5h5"],
  report: ["M6 3h8l4 4v14H6z", "M9 17v-3M12 17v-6M15 17v-4"],
  trophy: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4", "M12 13v4M8.5 20h7"],
  clock: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z", "M12 7.5V12l3 2"],
  map: ["m3 6 6-2.5 6 2.5 6-2.5V18l-6 2.5-6-2.5-6 2.5z", "M9 3.5V18M15 6v14.5"],
  timesheet: ["M4 5h16v15H4z", "M4 9.5h16M9 5v15"],
  board: ["M3 4h18v16H3z", "M9 4v16M15 4v16"],
  jobs: ["M3 7h18v13H3z", "M8.5 7V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v2", "M3 12.5h18"],
  contract: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "m9 16 1.5-1.5 1.5 1.5 3-3"],
  bill: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6M9 12h6"],
  collect: ["M3 7h18v11H3z", "M12 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 10.5h2M19 10.5h2"],
  payment: ["M3 6h18v12H3z", "M3 10h18", "M7 14.5h4"],
  percent: ["M19 5 5 19", "M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  ledger: ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 12h6M9 16h6"],
  hourglass: ["M7 3h10M7 21h10", "M8 3v3l4 5 4-5V3", "M8 21v-3l4-5 4 5v3"],
  calendar: ["M3 4.5h18V21H3z", "M3 9.5h18M8 2.5v4M16 2.5v4"],
  schedule: ["M3 4.5h18V21H3z", "M3 9.5h18M8 2.5v4M16 2.5v4", "M7 13.5h4M7 17h7"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.3.9 2-3.4z",
  ],
  approve: ["M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z", "m8.5 12 2.5 2.5 4.5-5"],
  dot: ["M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  more: ["M4 4h6.5v6.5H4z", "M13.5 4H20v6.5h-6.5z", "M4 13.5h6.5V20H4z", "M13.5 13.5H20V20h-6.5z"],
  close: ["M6 6l12 12M18 6 6 18"],
  signout: ["M14 4h5v16h-5", "M10 8 6 12l4 4M6 12h10"],
  video: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z", "m10 8.5 5.5 3.5-5.5 3.5z"],
  screen: ["M3 4h18v12H3z", "M8 20h8M12 16v4", "m9.5 11 2.5-2.5 2.5 2.5M12 8.5v5"],
  eye: ["M3 4h18v12H3z", "M8 20h8M12 16v4", "M7 10s2-3 5-3 5 3 5 3-2 3-5 3-5-3-5-3z"],
  online: ["M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5", "M18 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"],
  spark: ["M12 3.5 13.8 10 20.5 12l-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z"],
  tools: ["M14.5 5.5a4 4 0 0 0-5.3 5.3L4 16v4h4l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-2.5z"],
  chevron: ["m9 6 6 6-6 6"],
  navigate: ["m3 11 18-8-8 18-2-8z"],
  plus: ["M12 5v14M5 12h14"],
};

export function MobileIcon({
  name,
  size = 22,
}: {
  name: MobileIconName | ChromeIconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
