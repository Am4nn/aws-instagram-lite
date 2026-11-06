import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREDITS, MAX_PHOTO_BYTES, ensurePhotos, jpegProblem, photoUrl } from "./photos.js";
import { SEED_PHOTO_IDS } from "./seed.js";
import { makePng } from "./png.js";

const jpeg = (size = 16) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4)]);
const fakeFetch = (body: Buffer, calls: string[] = []) =>
  (async (url: string) => { calls.push(url); return new Response(new Uint8Array(body)); }) as unknown as typeof fetch;

describe("jpegProblem", () => {
  it("accepts a JPEG and rejects a PNG, junk or an oversized file", () => {
    expect(jpegProblem(jpeg())).toBeNull();
    expect(jpegProblem(makePng(4, 4))).toBe("not a JPEG");
    expect(jpegProblem(Buffer.from("<html>offline</html>"))).toBe("not a JPEG");
    expect(jpegProblem(jpeg(MAX_PHOTO_BYTES + 1))).toMatch(/too big/);
  });
});

describe("ensurePhotos", () => {
  it("downloads only what isn't cached (or is broken)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-"));
    writeFileSync(join(dir, "1.jpg"), jpeg());
    writeFileSync(join(dir, "2.jpg"), "broken");
    const calls: string[] = [];
    expect(await ensurePhotos([1, 2, 3], dir, fakeFetch(jpeg(), calls))).toBe(2);
    expect(calls).toEqual([photoUrl(2), photoUrl(3)]);
    expect(jpegProblem(readFileSync(join(dir, "3.jpg")))).toBeNull();
  });

  it("explains a failed download and refuses a non-JPEG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-"));
    const offline = (async () => { throw new Error("fetch failed"); }) as unknown as typeof fetch;
    await expect(ensurePhotos([7], dir, offline)).rejects.toThrow(/first seed needs internet/);
    await expect(ensurePhotos([7], dir, fakeFetch(Buffer.from("nope")))).rejects.toThrow(/not a JPEG/);
  });
});

describe("seed photos", () => {
  it("every seed photo is credited, and none is used twice", () => {
    expect(SEED_PHOTO_IDS.every((id) => CREDITS.some((c) => c.id === id))).toBe(true);
    expect(new Set(SEED_PHOTO_IDS).size).toBe(SEED_PHOTO_IDS.length);
  });
});
