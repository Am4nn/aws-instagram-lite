import { describe, it, expect } from "vitest";
import { gate } from "./gate";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const NOW = 1_700_000_000_000;
const fresh = `${b64({})}.${b64({ sub: "u1", exp: NOW / 1000 + 3600 })}.s`;
const stale = `${b64({})}.${b64({ sub: "u1", exp: NOW / 1000 + 10 })}.s`;
const SITE = "https://lite.example.com";

function req(o: { method?: string; path?: string; search?: string; headers?: Record<string, string>; idToken?: string; secret?: string }) {
  return gate({
    method: o.method ?? "GET", pathname: o.path ?? "/feed", search: o.search ?? "",
    headers: new Headers({ host: "lite.example.com", "x-forwarded-proto": "https", "x-origin-verify": "s3cret", ...o.headers }),
    idToken: o.idToken, originSecret: o.secret === undefined ? "s3cret" : o.secret, extraOrigins: [], now: NOW,
  });
}

describe("gate (what proxy.ts does with each request)", () => {
  it("403 without the CloudFront origin secret, on every path", () => {
    for (const path of ["/feed", "/login", "/bff/auth/signin"]) {
      expect(req({ path, headers: { "x-origin-verify": "" } })).toEqual({ type: "forbidden" });
    }
    expect(req({ headers: { "x-origin-verify": "wrong" }, idToken: fresh })).toEqual({ type: "forbidden" });
  });

  it("no secret configured (next dev) → no origin check", () => {
    expect(req({ secret: "", headers: { "x-origin-verify": "" }, idToken: fresh })).toEqual({ type: "next" });
  });

  it("a page with a fresh token renders", () => {
    expect(req({ idToken: fresh })).toEqual({ type: "next" });
  });

  it("a page with a missing or expiring token goes to the refresh endpoint and back", () => {
    expect(req({ idToken: stale })).toEqual({ type: "redirect", location: "/bff/auth/refresh?next=%2Ffeed" });
    expect(req({ path: "/p/abc", search: "?u=bob" })).toEqual({ type: "redirect", location: "/bff/auth/refresh?next=%2Fp%2Fabc%3Fu%3Dbob" });
  });

  it("/login and /bff/* never redirect (no loops)", () => {
    expect(req({ path: "/login" })).toEqual({ type: "next" });
    expect(req({ path: "/bff/auth/refresh", search: "?next=/feed" })).toEqual({ type: "next" });
    expect(req({ path: "/bff/api/feed" })).toEqual({ type: "next" });
  });

  it("BFF mutations need our Origin and a JSON body", () => {
    const json = { "content-type": "application/json" };
    expect(req({ method: "POST", path: "/bff/api/posts/p1/like", headers: { ...json, origin: SITE } })).toEqual({ type: "next" });
    expect(req({ method: "POST", path: "/bff/api/posts/p1/like", headers: { ...json, origin: "https://evil.example.com" } }))
      .toMatchObject({ type: "error", status: 403 });
    expect(req({ method: "POST", path: "/bff/auth/signin", headers: json })).toMatchObject({ type: "error", status: 403 });
    expect(req({ method: "POST", path: "/bff/auth/signin", headers: { origin: SITE, "content-type": "text/plain" } }))
      .toMatchObject({ type: "error", status: 415 });
  });
});
