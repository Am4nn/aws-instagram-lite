"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fullDate, timeAgo } from "../../lib/time";
import { agoLong } from "../post/ago";

/**
 * Relative times on a server-rendered page. The server doesn't know the viewer's clock or time zone, so
 * the first render (server HTML + hydration) uses the server's request time in UTC: identical on both
 * sides, no hydration mismatch. Right after hydration it re-renders with the browser's clock and zone.
 */
const RenderedAt = createContext<number>(0);

/** In the root layout: the time the server rendered this request. */
export function ClockProvider({ now, children }: { now: number; children: ReactNode }) {
  return <RenderedAt.Provider value={now}>{children}</RenderedAt.Provider>;
}

/** `{ now, utc }` to compute relative times with; switches to the browser's clock after mount. */
export function useClock(): { now: number; utc: boolean; mounted: boolean } {
  const renderedAt = useContext(RenderedAt);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted || !renderedAt ? { now: Date.now(), utc: false, mounted: true } : { now: renderedAt, utc: true, mounted: false };
}

/** `<time>` with "5m" (or "5 minutes ago" when `long`) and the full local date as a tooltip. */
export function Time({ iso, className, long = false }: { iso: string; className?: string; long?: boolean }) {
  const { now, utc, mounted } = useClock();
  return (
    <time className={className} dateTime={iso} title={mounted ? fullDate(iso) : undefined}>
      {long ? agoLong(iso, now, utc) : timeAgo(iso, now, utc)}
    </time>
  );
}
