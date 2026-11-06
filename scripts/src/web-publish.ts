/**
 * Build the Next.js static export and publish it to the web bucket + CloudFront.
 * Shared by deploy:web (Floci) and deploy:aws (real AWS); only the env and the clients differ.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, DeleteObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { staleKeys, webUploadPlan } from "./web-plan.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const webDir = join(root, "web");
const outDir = join(webDir, "out");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(outDir, p)];
  });
}

/** `next build` → web/out. NEXT_PUBLIC_* in `env` win over web/.env.local. */
export function buildWeb(env: NodeJS.ProcessEnv = process.env): void {
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  const r = spawnSync(process.execPath, [next, "build"], { cwd: webDir, stdio: "inherit", env });
  if (r.status !== 0) throw new Error("next build failed");
}

/**
 * Upload web/out (content types + cache headers from webUploadPlan), delete keys older builds left
 * behind, then invalidate CloudFront so the new HTML is served.
 */
export async function publishWeb(o: {
  s3: S3Client; cloudfront: CloudFrontClient; bucket: string; distributionId: string;
}): Promise<{ uploaded: number; deleted: number }> {
  const plan = webUploadPlan(walk(outDir));
  for (const u of plan) {
    await o.s3.send(new PutObjectCommand({
      Bucket: o.bucket, Key: u.key, Body: readFileSync(join(outDir, u.file)),
      ContentType: u.contentType, CacheControl: u.cacheControl,
    }));
  }
  const existing: string[] = [];
  for await (const page of paginateListObjectsV2({ client: o.s3 }, { Bucket: o.bucket })) {
    for (const obj of page.Contents ?? []) if (obj.Key) existing.push(obj.Key);
  }
  const stale = staleKeys(existing, plan);
  for (const Key of stale) await o.s3.send(new DeleteObjectCommand({ Bucket: o.bucket, Key }));
  await o.cloudfront.send(new CreateInvalidationCommand({
    DistributionId: o.distributionId,
    InvalidationBatch: { CallerReference: String(Date.now()), Paths: { Quantity: 1, Items: ["/*"] } },
  }));
  return { uploaded: plan.length, deleted: stale.length };
}
