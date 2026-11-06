import { Jimp } from "jimp";

export const THUMB_WIDTH = 320;
export const FULL_WIDTH = 1080;
const QUALITY = 80;

/**
 * Original → 320px thumb (grids) + 1080px full (post page), both JPEG.
 * Pure JS (jimp) so it runs in any Lambda container; big orgs use `sharp` (native, ~10× faster).
 */
export async function resizeImage(buf: Buffer) {
  const original = await Jimp.read(buf);
  const { width, height } = original;
  const make = async (maxWidth: number) => {
    const img = original.clone();
    if (img.width > maxWidth) img.resize({ w: maxWidth });
    return img.getBuffer("image/jpeg", { quality: QUALITY });
  };
  return { thumb: await make(THUMB_WIDTH), full: await make(FULL_WIDTH), width, height };
}
