import { NextResponse, type NextRequest } from "next/server";
import { ID_COOKIE } from "./lib/server/cookies";
import { serverEnv } from "./lib/server/env";
import { gate } from "./lib/server/gate";

/**
 * Runs before every page and /bff/* route (Next 16 "proxy", formerly middleware; Node runtime).
 * The decisions live in lib/server/gate.ts (unit-tested): origin secret, CSRF, login/refresh redirect.
 */
export function proxy(req: NextRequest) {
  const env = serverEnv();
  const r = gate({
    method: req.method, pathname: req.nextUrl.pathname, search: req.nextUrl.search, headers: req.headers,
    idToken: req.cookies.get(ID_COOKIE)?.value, originSecret: env.originSecret, extraOrigins: env.siteOrigins,
  });
  switch (r.type) {
    case "forbidden":
      return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    case "error":
      return NextResponse.json({ error: r.error }, { status: r.status });
    case "redirect":
      // Next wants an absolute URL here; OpenNext turns a same-origin one back into a relative Location,
      // so the browser stays on whatever host it used (CloudFront, custom domain, localhost:3000).
      return NextResponse.redirect(new URL(r.location, req.url), 307);
    default:
      return NextResponse.next();
  }
}

export const config = {
  // Everything except what CloudFront serves from S3 itself (build assets, photos) and the favicon.
  matcher: ["/((?!_next/static|_next/image|media/|favicon.ico).*)"],
};
