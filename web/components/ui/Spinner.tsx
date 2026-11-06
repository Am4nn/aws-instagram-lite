import type { CSSProperties } from "react";

/** Small ring spinner. `label` is announced to screen readers. */
export function Spinner({ size = 18, label = "Loading", className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ "--spinner-size": `${size}px` } as CSSProperties}
      role="status"
      aria-label={label}
    />
  );
}
