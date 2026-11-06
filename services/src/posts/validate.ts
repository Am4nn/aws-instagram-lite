import type { Validation } from "../users/validate.js";

// No WebP: jimp 1.x has no WebP decoder, so it would pass here and always fail in Resize.
export const ALLOWED_TYPES = ["image/jpeg", "image/png"] as const;
export type ImageType = (typeof ALLOWED_TYPES)[number];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const CAPTION_MAX = 2200;

export type CreatePostInput = { caption: string; contentType: ImageType; size: number };

export function validateCreatePost(body: unknown): Validation<CreatePostInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { caption, contentType, size } = body as Record<string, unknown>;
  if (!ALLOWED_TYPES.includes(contentType as ImageType)) {
    return { ok: false, error: `contentType must be one of ${ALLOWED_TYPES.join(", ")}` };
  }
  // The size is signed into the upload URL (Content-Length), so S3 rejects a bigger file.
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `size must be 1-${MAX_UPLOAD_BYTES} bytes` };
  }
  if (caption !== undefined && typeof caption !== "string") return { ok: false, error: "caption must be a string" };
  const clean = (caption ?? "").trim();
  if (clean.length > CAPTION_MAX) return { ok: false, error: `caption must be at most ${CAPTION_MAX} chars` };
  return { ok: true, value: { caption: clean, contentType: contentType as ImageType, size } };
}

/** Second line of defence: check what actually landed in S3 (emulators may not enforce signed sizes). */
export function checkUpload(o: { contentType?: string; size?: number }): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_TYPES.includes(o.contentType as ImageType)) return { ok: false, reason: `unsupported type ${o.contentType}` };
  if (!o.size) return { ok: false, reason: "empty upload" };
  if (o.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `too big: ${o.size} bytes (max ${MAX_UPLOAD_BYTES})` };
  return { ok: true };
}
