import { timeAgo } from "../../lib/time";

const UNIT: Record<string, string> = { m: "minute", h: "hour", d: "day" };

/** Spelled-out relative time for a footer line: "Just now", "5 minutes ago", "2 days ago", "Nov 2". */
export function agoLong(iso: string): string {
  const s = timeAgo(iso);
  if (s === "now") return "Just now";
  const m = /^(\d+)([mhd])$/.exec(s);
  if (!m) return s;
  const n = Number(m[1]);
  return `${n} ${UNIT[m[2]]}${n === 1 ? "" : "s"} ago`;
}
