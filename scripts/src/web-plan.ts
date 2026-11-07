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

/**
 * Static-site upload plan:
 *  - `_next/static/*` file names contain a content hash → cache forever (`immutable`)
 *  - everything else (HTML, Next page-data .txt, favicon) has no hash → `no-cache` (revalidate each time)
 *  - each page also gets an extensionless key (`login.html` → `login`) so `/login` works on plain
 *    S3+CloudFront (the usual alternative is a CloudFront Function rewriting the URL)
 */
export function webUploadPlan(files: string[]): Upload[] {
  const out: Upload[] = [];
  for (const file of files.map((f) => f.replace(/\\/g, "/"))) {
    const ext = file.split(".").pop()!.toLowerCase();
    const contentType = TYPES[ext] ?? "application/octet-stream";
    const cacheControl = file.startsWith("_next/static/") ? "public, max-age=31536000, immutable"
      : "no-cache"; // unhashed names (HTML, Next .txt page data, favicon) must revalidate after each deploy
    out.push({ key: file, file, contentType, cacheControl });
    if (ext === "html" && file !== "index.html" && file !== "404.html") {
      out.push({ key: file.slice(0, -".html".length), file, contentType, cacheControl });
    }
  }
  return out;
}

/** Keys left in the bucket from older builds (old pages, old hashed chunks): delete after uploading. */
export function staleKeys(existing: string[], plan: Upload[]): string[] {
  const keep = new Set(plan.map((u) => u.key));
  return existing.filter((k) => !keep.has(k));
}
