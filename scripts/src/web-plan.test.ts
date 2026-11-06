import { describe, it, expect } from "vitest";
import { staleKeys, webUploadPlan } from "./web-plan.js";

describe("webUploadPlan (what to upload for a static Next.js export)", () => {
  const plan = webUploadPlan(["index.html", "login.html", "u.html", "404.html", "_next/static/chunks/a1b2.js",
    "_next/static/css/x.css", "favicon.ico", "feed.txt", "feed\\__next.feed\\__PAGE__.txt"]);
  const byKey = new Map(plan.map((p) => [p.key, p]));

  it("uploads every file under its own path with the right content type", () => {
    expect(byKey.get("login.html")).toMatchObject({ file: "login.html", contentType: "text/html; charset=utf-8" });
    expect(byKey.get("_next/static/chunks/a1b2.js")?.contentType).toBe("text/javascript; charset=utf-8");
    expect(byKey.get("_next/static/css/x.css")?.contentType).toBe("text/css; charset=utf-8");
  });

  it("adds an extensionless copy of each page so /login works without a CloudFront Function", () => {
    expect(byKey.get("login")).toMatchObject({ file: "login.html", contentType: "text/html; charset=utf-8" });
    expect(byKey.get("u")).toMatchObject({ file: "u.html" });
    expect(byKey.has("index")).toBe(false); // "/" is served by DefaultRootObject
    expect(byKey.has("404")).toBe(false);
  });

  it("caches hashed assets forever and makes HTML always revalidate", () => {
    expect(byKey.get("_next/static/chunks/a1b2.js")?.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(byKey.get("login")?.cacheControl).toBe("no-cache");
    expect(byKey.get("index.html")?.cacheControl).toBe("no-cache");
  });

  it("revalidates every unhashed file (Next's per-page .txt data changes each build), incl. Windows paths", () => {
    expect(byKey.get("feed.txt")?.cacheControl).toBe("no-cache");
    expect(byKey.get("feed/__next.feed/__PAGE__.txt")?.cacheControl).toBe("no-cache");
    expect(byKey.get("favicon.ico")?.cacheControl).toBe("no-cache");
  });
});

describe("staleKeys (files from older builds)", () => {
  it("lists bucket keys the new build no longer has, so old pages and chunks are deleted", () => {
    const plan = webUploadPlan(["index.html", "login.html", "_next/static/new.js"]);
    expect(staleKeys(["index.html", "login", "login.html", "_next/static/old.js", "gone.html", "gone"], plan))
      .toEqual(["_next/static/old.js", "gone.html", "gone"]);
  });
});
