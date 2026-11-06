import { describe, it, expect } from "vitest";
import { normalizeUsername, validateProfileInput } from "./validate.js";

describe("normalizeUsername", () => {
  it("trims and lowercases so 'Alice ' and 'ALICE' are the same name", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
    expect(normalizeUsername("ALICE")).toBe(normalizeUsername("alice "));
  });
});

describe("validateProfileInput", () => {
  it("accepts a valid username and bio, normalizing the username", () => {
    expect(validateProfileInput({ username: " Bob_2 ", bio: "hi" }))
      .toEqual({ ok: true, value: { username: "bob_2", bio: "hi" } });
  });

  it("defaults a missing bio to empty", () => {
    expect(validateProfileInput({ username: "bob" })).toEqual({ ok: true, value: { username: "bob", bio: "" } });
  });

  it("rejects too short / too long / bad characters", () => {
    for (const username of ["ab", "a".repeat(21), "bad-name", "has space", ""]) {
      const r = validateProfileInput({ username });
      expect(r.ok, username).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/3-20/);
    }
  });

  it("rejects a bio over 150 chars", () => {
    const r = validateProfileInput({ username: "bob", bio: "x".repeat(151) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/150/);
  });

  it("rejects a non-object body", () => {
    for (const body of [null, "x", 3, []]) expect(validateProfileInput(body).ok).toBe(false);
  });
});
