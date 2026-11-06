import type { Validation } from "../users/validate.js";

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof ALLOWED_TYPES)[number];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const CAPTION_MAX = 2200;

export type CreatePostInput = { caption: string; contentType: ImageType };

export function validateCreatePost(body: unknown): Validation<CreatePostInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { caption, contentType } = body as Record<string, unknown>;
  if (!ALLOWED_TYPES.includes(contentType as ImageType)) {
    return { ok: false, error: `contentType must be one of ${ALLOWED_TYPES.join(", ")}` };
  }
  if (caption !== undefined && typeof caption !== "string") return { ok: false, error: "caption must be a string" };
  const clean = (caption ?? "").trim();
  if (clean.length > CAPTION_MAX) return { ok: false, error: `caption must be at most ${CAPTION_MAX} chars` };
  return { ok: true, value: { caption: clean, contentType: contentType as ImageType } };
}

/**
 * A presigned PUT can't enforce size, so the pipeline checks what actually landed in S3.
 * (A presigned POST policy with content-length-range could reject it at upload time.)
 */
export function checkUpload(o: { contentType?: string; size?: number }): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_TYPES.includes(o.contentType as ImageType)) return { ok: false, reason: `unsupported type ${o.contentType}` };
  if (!o.size) return { ok: false, reason: "empty upload" };
  if (o.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `too big: ${o.size} bytes (max ${MAX_UPLOAD_BYTES})` };
  return { ok: true };
}
