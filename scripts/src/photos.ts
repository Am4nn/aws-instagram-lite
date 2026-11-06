/**
 * Real demo photos for the seed: Unsplash photos served by picsum.photos (Unsplash license, no API key).
 * Fixed ids keep the seed deterministic; who took each one is in photo-credits.json (committed).
 * Files are cached in scripts/.photos/<id>.jpg (gitignored), so only the first seed needs internet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // same cap as POST /posts
export const PHOTO_DIR = fileURLToPath(new URL("../.photos/", import.meta.url));

export type Credit = { id: number; author: string; unsplash: string };
export const CREDITS: Credit[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./photo-credits.json", import.meta.url)), "utf8"),
);

export const photoUrl = (id: number) => `https://picsum.photos/id/${id}/1080/1080.jpg`;

/** Why `bytes` can't be uploaded as a seed photo, or null if it's a JPEG within the size cap. */
export function jpegProblem(bytes: Uint8Array): string | null {
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "not a JPEG";
  if (bytes.length > MAX_PHOTO_BYTES) return `too big: ${bytes.length} bytes (max ${MAX_PHOTO_BYTES})`;
  return null;
}

/** Downloads any photo not yet cached (or cached but broken). Returns the number downloaded. */
export async function ensurePhotos(ids: number[], dir = PHOTO_DIR, fetchFn: typeof fetch = fetch): Promise<number> {
  mkdirSync(dir, { recursive: true });
  let downloaded = 0;
  for (const id of ids) {
    const file = join(dir, `${id}.jpg`);
    if (existsSync(file) && !jpegProblem(readFileSync(file))) continue;
    const url = photoUrl(id);
    let bytes: Buffer;
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      throw new Error(
        `Couldn't download seed photo ${id} from ${url} (${(e as Error).message}). ` +
        `The first seed needs internet; after that the photos are cached in scripts/.photos.`,
      );
    }
    const problem = jpegProblem(bytes);
    if (problem) throw new Error(`Seed photo ${id} from ${url}: ${problem}`);
    writeFileSync(file, bytes);
    downloaded++;
  }
  return downloaded;
}

export const readPhoto = (id: number, dir = PHOTO_DIR) => readFileSync(join(dir, `${id}.jpg`));
