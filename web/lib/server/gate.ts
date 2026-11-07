import { checkMutation, siteOrigins } from "./csrf";
import { isFresh } from "./jwt";
import { ORIGIN_HEADER, originVerified } from "./origin-verify";

export type GateResult =
  | { type: "next" }
  | { type: "forbidden" }
  | { type: "error"; status: number; error: string }
  | { type: "redirect"; location: string };

/** Pages anyone may open. Everything else needs a login. */
const isPublic = (path: string) => path === "/login" || path.startsWith("/bff/");

/**
 * The decision proxy.ts makes for every request (pure, so it's unit-tested):
 *  1. no CloudFront origin secret → 403
 *  2. /bff/* mutations → CSRF check (Origin + JSON)
 *  3. a page without a fresh ID token → /bff/auth/refresh?next=<page> (the refresh cookie is only sent
 *     there; it swaps it for a new ID token and comes back, or sends you to /login)
 * Redirects are relative: behind CloudFront this server doesn't know the public host name for sure.
 */
export function gate(r: {
  method: string; pathname: string; search: string; headers: Headers; idToken?: string;
  originSecret?: string; extraOrigins: string[]; now?: number;
}): GateResult {
  if (!originVerified(r.headers.get(ORIGIN_HEADER), r.originSecret)) return { type: "forbidden" };
  if (r.pathname.startsWith("/bff/")) {
    const bad = checkMutation({
      method: r.method, origin: r.headers.get("origin"), contentType: r.headers.get("content-type"),
      allowed: siteOrigins(r.headers, r.extraOrigins),
    });
    if (bad) return { type: "error", ...bad };
  }
  if (isPublic(r.pathname) || isFresh(r.idToken, r.now)) return { type: "next" };
  return { type: "redirect", location: `/bff/auth/refresh?next=${encodeURIComponent(r.pathname + r.search)}` };
}
