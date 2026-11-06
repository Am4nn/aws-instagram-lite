import { describe, it, expect } from "vitest";
import { makePng } from "./png.js";

describe("makePng", () => {
  it("writes a PNG signature and the requested size in IHDR", () => {
    const png = makePng(30, 20);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(30);
    expect(png.readUInt32BE(20)).toBe(20);
  });
});
