/**
 * CSRF defence for /bff/* (on top of SameSite=Lax cookies), the standard pair:
 *  1. Origin must be our own site. Browsers always send Origin on cross-site POST/PUT/DELETE and pages can't fake it.
 *  2. The body must be JSON. A cross-site <form> can only send form/text bodies; sending JSON cross-site
 *     needs a CORS preflight, which we never answer.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function checkMutation(r: {
  method: string; origin: string | null; contentType: string | null; allowed: string[];
}): null | { status: 403 | 415; error: string } {
  if (SAFE.has(r.method.toUpperCase())) return null;
  if (!r.origin || !r.allowed.includes(r.origin)) return { status: 403, error: "cross-site request refused" };
  const type = (r.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { status: 415, error: "send JSON (content-type: application/json)" };
  return null;
}

/**
 * Our site's origin(s) as the browser sees them. Behind CloudFront the Lambda's Host header is the
 * Function URL host, so a CloudFront Function copies the viewer's Host into x-forwarded-host.
 * `extra` = origins from config (e.g. the custom domain).
 */
export function siteOrigins(h: Headers, extra: string[]): string[] {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? h.get("cloudfront-forwarded-proto") ?? "http";
  const own = host ? [`${proto.split(",")[0].trim()}://${host}`] : [];
  return [...own, ...extra.filter((o) => !own.includes(o))];
}
