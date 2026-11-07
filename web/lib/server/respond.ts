import { NextResponse } from "next/server";
import type { CookieSpec } from "./cookies";

/** Attach cookies to a route-handler response. */
export function withCookies<T extends NextResponse>(res: T, cookies: CookieSpec[]): T {
  for (const c of cookies) res.cookies.set(c.name, c.value, c.options);
  return res;
}

/** A redirect with a relative Location (behind CloudFront the server can't trust its own host name). */
export function relativeRedirect(location: string, status: 303 | 307 = 303): NextResponse {
  return new NextResponse(null, { status, headers: { location, "cache-control": "no-store" } });
}

/** JSON body of a request, or {} if it has none / isn't JSON. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");

export const jsonError = (status: number, error: string, code?: string) =>
  NextResponse.json({ error, ...(code ? { code } : {}) }, { status, headers: { "cache-control": "no-store" } });
