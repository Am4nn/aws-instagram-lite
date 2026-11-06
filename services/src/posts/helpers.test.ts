import { describe, it, expect } from "vitest";
import { Jimp } from "jimp";
import { uploadKey, parseUploadKey, mediaKeys } from "./keys.js";
import { validateCreatePost, checkUpload, MAX_UPLOAD_BYTES } from "./validate.js";
import { resizeImage } from "./resize.js";

describe("keys", () => {
  it("round-trips an upload key", () => {
    expect(uploadKey("u1", "p1")).toBe("uploads/u1/p1");
    expect(parseUploadKey("uploads/u1/p1")).toEqual({ userId: "u1", postId: "p1" });
  });

  it("rejects keys outside uploads/<user>/<post>", () => {
    for (const k of ["media/p1/thumb.jpg", "uploads/u1", "uploads/u1/p1/extra", "uploads/a/../b", "uploads//p1"]) {
      expect(parseUploadKey(k), k).toBeNull();
    }
  });

  it("names media files per post", () => {
    expect(mediaKeys("p1")).toEqual({ thumb: "media/p1/thumb.jpg", full: "media/p1/full.jpg" });
  });
});

describe("validateCreatePost", () => {
  it("accepts a caption + allowed type", () => {
    expect(validateCreatePost({ caption: " hi ", contentType: "image/png" }))
      .toEqual({ ok: true, value: { caption: "hi", contentType: "image/png" } });
  });

  it("rejects other content types and captions over 2200 chars", () => {
    expect(validateCreatePost({ caption: "", contentType: "image/gif" }).ok).toBe(false);
    expect(validateCreatePost({ caption: "x".repeat(2201), contentType: "image/png" }).ok).toBe(false);
    expect(validateCreatePost(null).ok).toBe(false);
  });
});

describe("checkUpload", () => {
  it("allows jpeg/png/webp up to 5 MB", () => {
    expect(checkUpload({ contentType: "image/webp", size: MAX_UPLOAD_BYTES })).toEqual({ ok: true });
  });
  it("rejects too big, empty and wrong type", () => {
    expect(checkUpload({ contentType: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false });
    expect(checkUpload({ contentType: "image/png", size: 0 })).toMatchObject({ ok: false });
    expect(checkUpload({ contentType: "text/plain", size: 10 })).toMatchObject({ ok: false });
  });
});

describe("resizeImage", () => {
  const png = async (w: number, h: number) =>
    new Jimp({ width: w, height: h, color: 0x3366ccff }).getBuffer("image/png");

  it("makes a 320px thumb and a 1080px full JPEG from a big image", async () => {
    const r = await resizeImage(await png(2000, 1000));
    const thumb = await Jimp.read(r.thumb);
    const full = await Jimp.read(r.full);
    expect(thumb.width).toBe(320);
    expect(full.width).toBe(1080);
    expect([r.thumb[0], r.thumb[1]]).toEqual([0xff, 0xd8]);
    expect([r.full[0], r.full[1]]).toEqual([0xff, 0xd8]);
    expect(r).toMatchObject({ width: 2000, height: 1000 });
  });

  it("never upscales small images", async () => {
    const r = await resizeImage(await png(200, 100));
    expect((await Jimp.read(r.full)).width).toBe(200);
    expect((await Jimp.read(r.thumb)).width).toBe(200);
  });

  it("throws on bytes that are not an image", async () => {
    await expect(resizeImage(Buffer.from("not an image"))).rejects.toThrow();
  });
});
