import { describe, it, expect } from "vitest";
import { originVerified } from "./origin-verify";

describe("originVerified (only CloudFront knows the secret)", () => {
  it("rejects a missing or wrong header", () => {
    expect(originVerified(null, "s3cret")).toBe(false);
    expect(originVerified("nope", "s3cret")).toBe(false);
    expect(originVerified("s3cre", "s3cret")).toBe(false);
  });
  it("accepts the right header", () => {
    expect(originVerified("s3cret", "s3cret")).toBe(true);
  });
  it("is off when no secret is configured (next dev)", () => {
    expect(originVerified(null, undefined)).toBe(true);
    expect(originVerified(null, "")).toBe(true);
  });
});
