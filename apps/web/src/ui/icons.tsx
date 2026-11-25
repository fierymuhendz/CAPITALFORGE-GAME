import type { ReactElement } from "react";

const P: Record<string, ReactElement> = {
  city: <path d="M3 21V9l6-3v15M9 21V4l6 3v14M15 21V11l6 2v8M3 21h18M6 12h1M6 15h1M12 9h1M12 12h1M12 15h1" />,
  factory: <path d="M3 21V10l6 4v-4l6 4V6h3v15H3zM7 18h2M12 18h2M17 18h1" />,
  chart: <path d="M4 20V4M4 20h16M8 16l3-4 3 2 5-7" />,
  truck: <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8M6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8" />,
  wallet: <path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 7l12-3v3M17 14h.01" />,
  flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M8 15h8" />,
  bell: <path d="M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21h4" />,
  user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />,
  doc: <path d="M6 3h9l4 4v14H6V3zM14 3v5h5M9 13h6M9 17h6" />,
  building: <path d="M4 21V5l8-2v18M12 8l8 2v11M4 21h16M8 8h1M8 12h1M8 16h1" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  flat: <path d="M5 12h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  sun: <path d="M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />,
  clock: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2" />,
  split: <path d="M12 4v6M12 10l-6 6v4M12 10l6 6v4" />,
  alert: <path d="M12 4l9 16H3L12 4zM12 10v4M12 17h.01" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" />,
  ship: <path d="M3 17l9 4 9-4M5 17V9l7-3 7 3v8M12 6v15" />,
  coins: <path d="M12 7c4.4 0 8-1.1 8-2.5S16.4 2 12 2 4 3.1 4 4.5S7.6 7 12 7zM4 4.5v5C4 10.9 7.6 12 12 12s8-1.1 8-2.5v-5M4 9.5v5C4 15.9 7.6 17 12 17s8-1.1 8-2.5v-5M4 14.5v5C4 20.9 7.6 22 12 22s8-1.1 8-2.5v-5" />,
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
};

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name] ?? P.more}
    </svg>
  );
}
