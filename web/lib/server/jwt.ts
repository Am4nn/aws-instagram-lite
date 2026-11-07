/**
 * Read claims from a JWT WITHOUT checking its signature. Only for decisions that are safe to get wrong
 * (is it about to expire? which user is this, for display?). The HTTP API's JWT authorizer verifies
 * every token for real on every call.
 */
export function jwtClaims(token: string): { sub?: string; exp?: number } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const c = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof c === "object" && c ? { ...(c.sub ? { sub: String(c.sub) } : {}), ...(typeof c.exp === "number" ? { exp: c.exp } : {}) } : null;
  } catch {
    return null;
  }
}

/** True if the token is still valid for more than `skewMs` (default 1 min). */
export function isFresh(token: string | undefined, nowMs: number = Date.now(), skewMs = 60_000): boolean {
  const exp = token ? jwtClaims(token)?.exp : undefined;
  return typeof exp === "number" && exp * 1000 - nowMs > skewMs;
}
