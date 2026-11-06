import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pagination cursor = "<base64url JSON>.<base64url HMAC>". Signed so clients can't forge positions
 * or peek at internal keys. The key comes from Secrets Manager (never hardcoded).
 */
export function signCursor(before: string, key: string): string {
  const body = Buffer.from(JSON.stringify({ before })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function verifyCursor(token: string, key: string): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { before } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof before === "string" ? before : null;
  } catch {
    return null;
  }
}
