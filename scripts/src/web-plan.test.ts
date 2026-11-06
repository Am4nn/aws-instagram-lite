import { describe, it, expect } from "vitest";
import { webUploadPlan } from "./web-plan.js";

describe("webUploadPlan (what to upload for a static Next.js export)", () => {
  const plan = webUploadPlan(["index.html", "login.html", "u.html", "404.html", "_next/static/chunks/a1b2.js", "_next/static/css/x.css", "favicon.ico"]);
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
});
