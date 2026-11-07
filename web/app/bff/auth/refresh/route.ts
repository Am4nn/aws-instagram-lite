import { NextResponse, type NextRequest } from "next/server";
import { refresh } from "../../../../lib/server/cognito";
import { clearedCookies, REFRESH_COOKIE, sessionCookies } from "../../../../lib/server/cookies";
import { serverEnv } from "../../../../lib/server/env";
import { safeNext } from "../../../../lib/server/next-path";
import { jsonError, relativeRedirect, withCookies } from "../../../../lib/server/respond";

/**
 * The only place the refresh cookie is sent to (Path=/bff/auth). Swaps it for a new ID token.
 *  GET ?next=/feed  (a page load whose ig_id had expired, sent here by proxy.ts) → back to `next`, or /login
 *  POST             (browser fetch that got a 401) → 200 with a new ig_id, or 401
 */
async function renew(req: NextRequest) {
  const token = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!token) return null;
  try {
    return sessionCookies(await refresh(token), serverEnv().secureCookies);
  } catch {
    return null; // expired, revoked, or the user pool was reset
  }
}

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const cookies = await renew(req);
  if (cookies) return withCookies(relativeRedirect(next), cookies);
  return withCookies(relativeRedirect(`/login?next=${encodeURIComponent(next)}`), clearedCookies(serverEnv().secureCookies));
}

export async function POST(req: NextRequest) {
  const cookies = await renew(req);
  if (cookies) return withCookies(NextResponse.json({ ok: true }), cookies);
  return withCookies(jsonError(401, "signed out"), clearedCookies(serverEnv().secureCookies));
}
