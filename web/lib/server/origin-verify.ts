/**
 * The Lambda Function URL is public (authType NONE), so CloudFront adds a secret header
 * `x-origin-verify` to every request it forwards. A request without it came straight to the Function URL
 * (skipping CloudFront's HTTPS, security headers and caching) and gets a 403.
 * No secret configured = `next dev` on localhost: check off.
 */
export const ORIGIN_HEADER = "x-origin-verify";

export function originVerified(header: string | null, secret: string | undefined): boolean {
  if (!secret) return true;
  if (!header || header.length !== secret.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < secret.length; i++) diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
