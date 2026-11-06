import { describe, it, expect } from "vitest";
import { signCursor, verifyCursor } from "./cursor.js";

describe("cursor", () => {
  const key = "k".repeat(32);
  it("round-trips a signed position", () => {
    expect(verifyCursor(signCursor("2026-01-01T00:00:00Z#p1", key), key)).toBe("2026-01-01T00:00:00Z#p1");
  });
  it("rejects tampered, foreign-key and garbage cursors", () => {
    const good = signCursor("2026-01-01T00:00:00Z#p1", key);
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ before: "9999" })).toString("base64url") + "." + sig;
    expect(verifyCursor(forged, key)).toBeNull();
    expect(verifyCursor(good, "other-key")).toBeNull();
    expect(verifyCursor(body, key)).toBeNull();
    expect(verifyCursor("!!!", key)).toBeNull();
  });
});

