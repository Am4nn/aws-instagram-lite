/** Theme preference: 'system' follows the OS; 'light' / 'dark' force it via <html data-theme>. */
export type ThemePref = "light" | "dark" | "system";

export const THEME_KEY = "theme";

export function getTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: ThemePref): void {
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage blocked: still apply for this page view */
  }
  applyTheme(t);
}

export function applyTheme(t: ThemePref): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/** What is actually showing right now. */
export function resolvedTheme(): "light" | "dark" {
  const t = getTheme();
  if (t !== "system") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const NEXT_THEME: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

/** Inline in <head> (layout.tsx) so the right theme is set before first paint. Keep it tiny. */
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
