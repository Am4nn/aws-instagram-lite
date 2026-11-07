const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Compact relative time: "now", "5m", "2h", "3d", then "Nov 2" (or "Nov 2, 2025" for another year).
 * `utc`: date labels in UTC (the server render, which doesn't know the viewer's time zone; see ui/Time.tsx).
 */
export function timeAgo(iso: string, now: number = Date.now(), utc = false): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(t);
  const [month, day, year] = utc ? [date.getUTCMonth(), date.getUTCDate(), date.getUTCFullYear()]
    : [date.getMonth(), date.getDate(), date.getFullYear()];
  const nowYear = utc ? new Date(now).getUTCFullYear() : new Date(now).getFullYear();
  const label = `${MONTHS[month]} ${day}`;
  return year === nowYear ? label : `${label}, ${year}`;
}

/** Full date for a title tooltip, e.g. "Nov 2, 2026, 4:05 PM". */
export function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
