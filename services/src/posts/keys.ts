const ID = /^[A-Za-z0-9-]+$/;

/** Where the browser uploads the original photo. */
export const uploadKey = (userId: string, postId: string) => `uploads/${userId}/${postId}`;

/** Inverse of uploadKey; null for anything else (so stray objects never start a pipeline). */
export function parseUploadKey(key: string): { userId: string; postId: string } | null {
  const parts = key.split("/");
  if (parts.length !== 3 || parts[0] !== "uploads") return null;
  const [, userId, postId] = parts;
  return ID.test(userId) && ID.test(postId) ? { userId, postId } : null;
}

/** Processed images written by the resize step. */
export const mediaKeys = (postId: string) => ({
  thumb: `media/${postId}/thumb.jpg`,
  full: `media/${postId}/full.jpg`,
});

/** Browser URL of a media object: CloudFront serves the media bucket at /media/* (same site, cached at the edge). */
export const mediaUrl = (key: string) => `/${key}`;
