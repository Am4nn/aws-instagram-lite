/**
 * Which browser calls /bff/api/<path> may forward to the HTTP API. An allowlist, so the BFF only
 * exposes what the pages need (and nothing like path tricks: each segment is a plain id or name).
 * `:x` = one id/name segment.
 */
const ROUTES: [method: string, pattern: string][] = [
  ["GET", "/feed"],
  ["GET", "/me"],
  ["PUT", "/me"],
  ["GET", "/users/:x"],
  ["GET", "/users/:x/posts"],
  ["POST", "/users/:x/follow"],
  ["DELETE", "/users/:x/follow"],
  ["POST", "/posts"],
  ["GET", "/posts/:x"],
  ["POST", "/posts/:x/like"],
  ["DELETE", "/posts/:x/like"],
  ["GET", "/posts/:x/comments"],
  ["POST", "/posts/:x/comments"],
  ["GET", "/notifications"],
  ["POST", "/notifications/read"],
];

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** The API path to call, or null if this method + path isn't allowed. */
export function matchForward(method: string, segments: string[]): string | null {
  if (segments.length === 0 || !segments.every((s) => SEGMENT.test(s))) return null;
  const m = method.toUpperCase();
  for (const [rm, pattern] of ROUTES) {
    const parts = pattern.slice(1).split("/");
    if (rm === m && parts.length === segments.length && parts.every((p, i) => p === ":x" || p === segments[i])) {
      return `/${segments.join("/")}`;
    }
  }
  return null;
}
