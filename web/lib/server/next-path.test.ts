import { describe, it, expect } from "vitest";
import { safeNext } from "./next-path";

describe("safeNext (where to go after login/refresh)", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNext("/u/bob")).toBe("/u/bob");
    expect(safeNext("/p/abc?u=bob")).toBe("/p/abc?u=bob");
  });
  it("falls back to /feed for anything that could leave the site", () => {
    for (const bad of [null, "", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "feed"]) {
      expect(safeNext(bad), String(bad)).toBe("/feed");
    }
  });
  it("never loops back into the auth endpoints", () => {
    expect(safeNext("/bff/auth/refresh?next=/feed")).toBe("/feed");
    expect(safeNext("/login")).toBe("/feed");
  });
});
