import { describe, it, expect } from "vitest";
import { Jimp } from "jimp";
import { imageSize } from "./image-size.js";

describe("imageSize (reads dimensions from the header without decoding)", () => {
  it("reads PNG and JPEG dimensions", async () => {
    const img = new Jimp({ width: 300, height: 200, color: 0xff0000ff });
    expect(imageSize(await img.getBuffer("image/png"))).toEqual({ width: 300, height: 200 });
    expect(imageSize(await img.getBuffer("image/jpeg"))).toEqual({ width: 300, height: 200 });
  });

  it("returns null for bytes that aren't a PNG/JPEG header", () => {
    expect(imageSize(Buffer.from("definitely not an image"))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
  });
});
