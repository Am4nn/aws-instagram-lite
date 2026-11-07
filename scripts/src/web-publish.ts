/**
 * Build the web app with OpenNext and publish its static assets to the web bucket.
 * Shared by deploy:web (Floci) and deploy:aws (real AWS); only the clients differ.
 *   buildWeb()   → web/.open-next/server-functions/default (the server Lambda's code, deployed by CDK)
 *                  + web/.open-next/assets (hashed JS/CSS/fonts, uploaded here)
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, DeleteObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { staleKeys, webUploadPlan } from "./web-plan.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const webDir = join(root, "web");
const assetsDir = join(webDir, ".open-next", "assets");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(assetsDir, p)];
  });
}

/**
 * `open-next build` (runs `next build` itself). No build-time settings: the server reads its config
 * from the Lambda's environment at request time (infra/lib/web.ts).
 * (OpenNext also tries to bundle an image-optimization function and logs an install error on Windows;
 * we don't deploy that function: images.unoptimized.)
 */
export function buildWeb(): void {
  const openNext = join(root, "node_modules", "@opennextjs", "aws", "dist", "index.js");
  const r = spawnSync(process.execPath, [openNext, "build"], { cwd: webDir, stdio: "inherit" });
  if (r.status !== 0) throw new Error("open-next build failed");
}

/** Upload web/.open-next/assets (content types + cache headers from webUploadPlan), then delete leftovers. */
export async function publishWeb(o: { s3: S3Client; bucket: string }): Promise<{ uploaded: number; deleted: number }> {
  const plan = webUploadPlan(walk(assetsDir));
  for (const u of plan) {
    await o.s3.send(new PutObjectCommand({
      Bucket: o.bucket, Key: u.key, Body: readFileSync(join(assetsDir, u.file)),
      ContentType: u.contentType, CacheControl: u.cacheControl,
    }));
  }
  const existing: string[] = [];
  for await (const page of paginateListObjectsV2({ client: o.s3 }, { Bucket: o.bucket })) {
    for (const obj of page.Contents ?? []) if (obj.Key) existing.push(obj.Key);
  }
  const stale = staleKeys(existing, plan);
  for (const Key of stale) await o.s3.send(new DeleteObjectCommand({ Bucket: o.bucket, Key }));
  return { uploaded: plan.length, deleted: stale.length };
}
