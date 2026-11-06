"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { getTheme, NEXT_THEME, setTheme, type ThemePref } from "../../lib/theme";

const ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const NAME = { system: "System", light: "Light", dark: "Dark" } as const;

/**
 * Cycles system -> light -> dark. The icon shows the CURRENT setting.
 * `className` defaults to "icon-btn"; pass `label` to render a text label next to the icon
 * (the sidebar passes its own classes + label span).
 */
export function ThemeToggle({ className = "icon-btn", label, size = 22 }: { className?: string; label?: (name: string) => ReactNode; size?: number }) {
  // Static export pre-renders as "system"; the real value is read after mount (the <head> script already applied it).
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => setPref(getTheme()), []);

  const Icon = ICON[pref];
  const next = NEXT_THEME[pref];
  const text = `Theme: ${NAME[pref]} (switch to ${NAME[next]})`;
  return (
    <button
      type="button"
      className={className}
      aria-label={text}
      title={text}
      onClick={() => {
        setTheme(next);
        setPref(next);
      }}
    >
      <span className="nav-icon" aria-hidden><Icon size={size} strokeWidth={1.8} /></span>
      {label?.(NAME[pref])}
    </button>
  );
}
