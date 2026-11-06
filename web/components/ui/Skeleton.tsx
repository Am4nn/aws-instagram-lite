import type { CSSProperties } from "react";

type Len = number | string;
const px = (v: Len | undefined) => (typeof v === "number" ? `${v}px` : v);

/** A shimmering block. Give it the SAME size as the content it stands in for (no layout shift). */
export function Skeleton({ w, h, r, circle, ratio, className = "", style }: {
  w?: Len;
  h?: Len;
  /** border radius */
  r?: Len;
  circle?: boolean;
  /** aspect-ratio, e.g. "1 / 1" for a photo tile */
  ratio?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`skeleton ${className}`.trim()}
      style={{ width: px(w), height: px(h), borderRadius: circle ? "50%" : px(r), aspectRatio: ratio, ...style }}
    />
  );
}

/** N lines of text placeholder; the last line is shorter. */
export function SkeletonText({ lines = 1, width = "100%", last = "60%" }: { lines?: number; width?: Len; last?: Len }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden className="skeleton skeleton-text" style={{ width: px(i === lines - 1 && lines > 1 ? last : width) }} />
      ))}
    </>
  );
}
