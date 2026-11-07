/**
 * `?next=` after login or a token refresh: only a path on this site (blocks open redirects such as
 * `//evil.com` or `https://evil.com`), and never an auth page (no redirect loops).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/feed";
  if (raw.startsWith("/bff/") || raw === "/login" || raw.startsWith("/login?")) return "/feed";
  return raw;
}
