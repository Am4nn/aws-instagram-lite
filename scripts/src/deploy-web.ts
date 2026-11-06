/**
 * npm run deploy:web: build the Next.js static export and publish it to S3 + CloudFront (local stage).
 *   1. next build (NEXT_PUBLIC_* from web/.env.local, written by deploy:local)
 *   2. upload web/out/* with content types + cache headers (+ extensionless page copies)
 *   3. invalidate CloudFront so the new HTML is served
 *   4. let the CloudFront origin call Floci's Cognito (CORS): WEB_ORIGIN in .env → recreate container
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { readOutputs } from "./deploy-local.js";
import { webUploadPlan } from "./web-plan.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = join(root, "web", "out");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(outDir, p)];
  });
}

/** Local CloudFront URL Floci serves for a distribution domain like abc123.cloudfront.net */
export const localCdnUrl = (domain: string) => `http://${domain.replace(/\.cloudfront\.net$/, "")}.cloudfront.localhost.floci.io:4566`;

function run(cmd: string, args: string[], cwd = root) {
  const r = spawnSync(process.execPath, [cmd, ...args], { cwd, stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${args.join(" ")} failed`);
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const out = readOutputs("ig-local-core");
  const url = localCdnUrl(out.DistributionDomain);

  // 4 first: if the CORS origin changes, the container is recreated (state persists, see docker-compose.yml)
  const envFile = join(root, ".env");
  const wanted = `WEB_ORIGIN=${url}\n`;
  if (!existsSync(envFile) || readFileSync(envFile, "utf8") !== wanted) {
    writeFileSync(envFile, wanted);
    console.log(`Allowing ${url} in Floci CORS (recreating the container)…`);
    const r = spawnSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new Error("docker compose up failed");
    await assertFlociUp();
  }

  run(join(root, "node_modules", "next", "dist", "bin", "next"), ["build"], join(root, "web"));

  const s3 = new S3Client({ forcePathStyle: true });
  const plan = webUploadPlan(walk(outDir));
  for (const u of plan) {
    await s3.send(new PutObjectCommand({
      Bucket: out.WebBucket, Key: u.key, Body: readFileSync(join(outDir, u.file)),
      ContentType: u.contentType, CacheControl: u.cacheControl,
    }));
  }
  await new CloudFrontClient({}).send(new CreateInvalidationCommand({
    DistributionId: out.DistributionId,
    InvalidationBatch: { CallerReference: String(Date.now()), Paths: { Quantity: 1, Items: ["/*"] } },
  }));
  console.log(`\nUploaded ${plan.length} objects. Open: ${url}/login\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
