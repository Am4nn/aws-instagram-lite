import { describe, it, expect } from "vitest";
import { clearedCookies, ID_COOKIE, REFRESH_COOKIE, sessionCookies } from "./cookies";

describe("session cookies", () => {
  const tokens = { idToken: "id.jwt.x", refreshToken: "refresh-x", expiresIn: 3600 };

  it("ig_id: httpOnly, SameSite=Lax, whole site, lives as long as the token", () => {
    const [id] = sessionCookies(tokens, false);
    expect(id).toEqual({
      name: ID_COOKIE, value: "id.jwt.x",
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 3600 },
    });
    expect(ID_COOKIE).toBe("ig_id");
  });

  it("ig_refresh: httpOnly, only sent to /bff/auth, 30 days", () => {
    const refresh = sessionCookies(tokens, false)[1];
    expect(refresh).toEqual({
      name: REFRESH_COOKIE, value: "refresh-x",
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/bff/auth", maxAge: 30 * 24 * 3600 },
    });
    expect(REFRESH_COOKIE).toBe("ig_refresh");
  });

  it("Secure only when asked (https on aws, plain http on Floci)", () => {
    expect(sessionCookies(tokens, true).every((c) => c.options.secure)).toBe(true);
    expect(sessionCookies(tokens, false).some((c) => c.options.secure)).toBe(false);
  });

  it("a refresh (no new refresh token) only rewrites ig_id", () => {
    expect(sessionCookies({ idToken: "a", expiresIn: 60 }, false).map((c) => c.name)).toEqual([ID_COOKIE]);
  });

  it("sign-out expires both cookies on the same paths they were set on", () => {
    const c = clearedCookies(true);
    expect(c.map((x) => [x.name, x.value, x.options.path, x.options.maxAge, x.options.secure])).toEqual([
      [ID_COOKIE, "", "/", 0, true], [REFRESH_COOKIE, "", "/bff/auth", 0, true],
    ]);
  });
});
