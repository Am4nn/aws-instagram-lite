import { Jimp } from "jimp";

export const THUMB_WIDTH = 320;
export const FULL_WIDTH = 1080;
const QUALITY = 80;

/**
 * Original → 320px thumb (grids) + 1080px full (post page), both JPEG.
 * Pure JS (jimp) so it runs in any Lambda container; big orgs use `sharp` (native, ~10× faster).
 */
export async function resizeImage(buf: Buffer) {
  const img = await Jimp.read(buf);
  const { width, height } = img;
  // Shrink in place to 1080 first, then make the thumb from that: the full-size original is
  // never copied (each copy of a 24 MP image is ~100 MB of raw pixels).
  if (img.width > FULL_WIDTH) img.resize({ w: FULL_WIDTH });
  const full = await img.getBuffer("image/jpeg", { quality: QUALITY });
  if (img.width > THUMB_WIDTH) img.resize({ w: THUMB_WIDTH });
  const thumb = await img.getBuffer("image/jpeg", { quality: QUALITY });
  return { thumb, full, width, height };
}
