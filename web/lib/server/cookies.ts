/**
 * The two login cookies. Both are httpOnly: JavaScript in the page can never read a token.
 *  - ig_id:      the Cognito ID token, sent with every request to the site (Path=/), lives as long as the token (1 h)
 *  - ig_refresh: the refresh token, only ever sent to /bff/auth/* (where it is swapped for a new ID token), 30 days
 * SameSite=Lax: another site can link to us (top-level GET carries the cookie) but can't POST with it.
 * Secure (https only) on aws; Floci serves plain http, where a Secure cookie would be dropped.
 */
export const ID_COOKIE = "ig_id";
export const REFRESH_COOKIE = "ig_refresh";
const REFRESH_PATH = "/bff/auth";
const REFRESH_MAX_AGE = 30 * 24 * 3600; // Cognito's default refresh-token lifetime

export type CookieSpec = {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number };
};

const spec = (name: string, value: string, path: string, maxAge: number, secure: boolean): CookieSpec =>
  ({ name, value, options: { httpOnly: true, secure, sameSite: "lax", path, maxAge } });

/** Cookies to set after sign-in (both) or after a refresh (no new refresh token → ig_id only). */
export function sessionCookies(t: { idToken: string; refreshToken?: string; expiresIn: number }, secure: boolean): CookieSpec[] {
  const out = [spec(ID_COOKIE, t.idToken, "/", t.expiresIn, secure)];
  if (t.refreshToken) out.push(spec(REFRESH_COOKIE, t.refreshToken, REFRESH_PATH, REFRESH_MAX_AGE, secure));
  return out;
}

/** Sign-out: expire both (a cookie is only replaced when name AND path match). */
export function clearedCookies(secure: boolean): CookieSpec[] {
  return [spec(ID_COOKIE, "", "/", 0, secure), spec(REFRESH_COOKIE, "", REFRESH_PATH, 0, secure)];
}
