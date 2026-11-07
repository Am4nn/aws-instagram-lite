export type Upload = { key: string; file: string; contentType: string; cacheControl: string };

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Upload plan for OpenNext's `.open-next/assets` (CloudFront serves `/_next/static/*` from the bucket):
 *  - `_next/static/*` names contain a content hash (or the build id) → cache forever (`immutable`)
 *  - anything else (BUILD_ID) → `no-cache`
 * Pages are no longer files: the server Lambda renders them.
 */
export function webUploadPlan(files: string[]): Upload[] {
  return files.map((file) => {
    const key = file.replace(/\\/g, "/");
    const ext = key.split(".").pop()!.toLowerCase();
    return {
      key, file,
      contentType: TYPES[ext] ?? "application/octet-stream",
      cacheControl: key.startsWith("_next/static/") ? IMMUTABLE : "no-cache",
    };
  });
}

/**
 * Keys to delete after uploading: leftovers outside `_next/static/` (e.g. the step 7 static-export pages).
 * Old hashed chunks stay: a page rendered by the previous deploy may still be open and load them.
 */
export function staleKeys(existing: string[], plan: Upload[]): string[] {
  const keep = new Set(plan.map((u) => u.key));
  return existing.filter((k) => !keep.has(k) && !k.startsWith("_next/static/"));
}
