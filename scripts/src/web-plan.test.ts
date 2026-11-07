import { describe, it, expect } from "vitest";
import { staleKeys, webUploadPlan } from "./web-plan.js";

describe("webUploadPlan (web/.open-next/assets → S3 web bucket)", () => {
  const plan = webUploadPlan(["BUILD_ID", "_next/static/chunks/a1b2.js", "_next/static/css/x.css",
    "_next\\static\\media\\font.woff2", "_next/static/abc123/_buildManifest.js"]);
  const byKey = new Map(plan.map((p) => [p.key, p]));

  it("uploads every file under its own path (Windows separators fixed) with the right content type", () => {
    expect(byKey.get("_next/static/chunks/a1b2.js")?.contentType).toBe("text/javascript; charset=utf-8");
    expect(byKey.get("_next/static/css/x.css")?.contentType).toBe("text/css; charset=utf-8");
    expect(byKey.get("_next/static/media/font.woff2")).toMatchObject({ file: "_next\\static\\media\\font.woff2", contentType: "font/woff2" });
  });

  it("caches hashed build assets forever; anything else revalidates", () => {
    expect(byKey.get("_next/static/chunks/a1b2.js")?.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(byKey.get("_next/static/abc123/_buildManifest.js")?.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(byKey.get("BUILD_ID")?.cacheControl).toBe("no-cache");
  });

  it("makes no extensionless page copies any more (pages come from the server)", () => {
    expect(plan).toHaveLength(5);
  });
});

describe("staleKeys", () => {
  it("removes the old static-export pages but keeps old hashed chunks (pages already open in a browser still load them)", () => {
    const plan = webUploadPlan(["BUILD_ID", "_next/static/new.js"]);
    expect(staleKeys(["login", "login.html", "index.html", "_next/static/old.js", "_next/static/new.js", "BUILD_ID"], plan))
      .toEqual(["login", "login.html", "index.html"]);
  });
});
