import type { CSSProperties } from "react";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

/** Deterministic hue (0-359) from a username, so the same user always gets the same colour. */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** "bob" -> "B", "jane_doe" -> "JD". */
export function initialsFor(name: string): string {
  const parts = name.replace(/^@/, "").split(/[_.\-\s]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0];
  return parts[0][0] + parts[1][0];
}

/** Initials avatar (no avatar images exist). sm 24, md 32, lg 56, xl 150 (84 on phones). Decorative by default. */
export function Avatar({ name, size = "md", className = "", title }: { name: string; size?: AvatarSize; className?: string; title?: string }) {
  const style = { "--h": hueFor(name) } as CSSProperties;
  return (
    <span className={`avatar avatar-${size} ${className}`.trim()} style={style} aria-hidden={title ? undefined : true} title={title}>
      {initialsFor(name)}
    </span>
  );
}
