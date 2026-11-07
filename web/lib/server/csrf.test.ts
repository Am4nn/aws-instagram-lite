import { describe, it, expect } from "vitest";
import { checkMutation, siteOrigins } from "./csrf";

const allowed = ["https://lite.example.com"];
const post = (origin: string | null, contentType: string | null = "application/json") =>
  checkMutation({ method: "POST", origin, contentType, allowed });

describe("checkMutation (CSRF: Origin + JSON)", () => {
  it("lets a same-site JSON POST through", () => {
    expect(post("https://lite.example.com")).toBeNull();
    expect(post("https://lite.example.com", "application/json; charset=utf-8")).toBeNull();
  });
  it("rejects a missing or foreign Origin with 403", () => {
    expect(post(null)?.status).toBe(403);
    expect(post("https://evil.example.com")?.status).toBe(403);
    expect(post("null")?.status).toBe(403);
  });
  it("rejects non-JSON bodies (what a cross-site <form> can send) with 415", () => {
    expect(post("https://lite.example.com", "text/plain")?.status).toBe(415);
    expect(post("https://lite.example.com", "application/x-www-form-urlencoded")?.status).toBe(415);
    expect(post("https://lite.example.com", null)?.status).toBe(415);
  });
  it("leaves safe methods alone", () => {
    expect(checkMutation({ method: "GET", origin: null, contentType: null, allowed })).toBeNull();
    expect(checkMutation({ method: "HEAD", origin: null, contentType: null, allowed })).toBeNull();
  });
  it("checks DELETE and PUT too", () => {
    expect(checkMutation({ method: "DELETE", origin: "https://evil.example.com", contentType: "application/json", allowed })?.status).toBe(403);
    expect(checkMutation({ method: "PUT", origin: "https://lite.example.com", contentType: "application/json", allowed })).toBeNull();
  });
});

describe("siteOrigins", () => {
  it("prefers x-forwarded-host (set by the CloudFront Function) over host", () => {
    const h = new Headers({ host: "abc.lambda-url.ap-southeast-2.on.aws", "x-forwarded-host": "d1.cloudfront.net", "x-forwarded-proto": "https" });
    expect(siteOrigins(h, [])).toEqual(["https://d1.cloudfront.net"]);
  });
  it("uses CloudFront-Forwarded-Proto, else http", () => {
    expect(siteOrigins(new Headers({ host: "a.test", "cloudfront-forwarded-proto": "https" }), [])).toEqual(["https://a.test"]);
    expect(siteOrigins(new Headers({ host: "localhost:3000" }), [])).toEqual(["http://localhost:3000"]);
  });
  it("adds the configured extra origins (custom domain)", () => {
    expect(siteOrigins(new Headers({ host: "a.test" }), ["https://lite.example.com"])).toEqual(["http://a.test", "https://lite.example.com"]);
  });
});
