/**
 * npm run deploy:web: build the Next.js static export and publish it to S3 + CloudFront (local stage).
 *   1. next build (NEXT_PUBLIC_* from web/.env.local, written by deploy:local)
 *   2. upload web/out/* with content types + cache headers (+ extensionless page copies), delete stale keys
 *   3. invalidate CloudFront so the new HTML is served
 *   4. let the CloudFront origin call Floci's Cognito (CORS): WEB_ORIGIN in .env → recreate container
 * Real AWS: npm run deploy:aws (same build + publish, see web-publish.ts).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { readOutputs } from "./deploy-local.js";
import { buildWeb, publishWeb } from "./web-publish.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Local CloudFront URL Floci serves for a distribution domain like abc123.cloudfront.net */
export const localCdnUrl = (domain: string) => `http://${domain.replace(/\.cloudfront\.net$/, "")}.cloudfront.localhost.floci.io:4566`;

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const out = readOutputs("ig-local-core");
  const url = localCdnUrl(out.DistributionDomain);

  // 4 first: if the CORS origin changes, the container is recreated (state persists, see docker-compose.yml)
  const envFile = join(root, ".env");
  const short = url.replace(".localhost.floci.io", ".localhost"); // Chrome/Edge resolve *.localhost themselves
  const wanted = `WEB_ORIGIN=${url}\nWEB_ORIGIN_SHORT=${short}\n`;
  if (!existsSync(envFile) || readFileSync(envFile, "utf8") !== wanted) {
    writeFileSync(envFile, wanted);
    console.log(`Allowing ${url} in Floci CORS (recreating the container)…`);
    const r = spawnSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new Error("docker compose up failed");
    await assertFlociUp();
  }

  buildWeb();
  const r = await publishWeb({
    s3: new S3Client({ forcePathStyle: true }), cloudfront: new CloudFrontClient({}),
    bucket: out.WebBucket, distributionId: out.DistributionId,
  });
  console.log(`\nUploaded ${r.uploaded} objects (${r.deleted} stale removed). Open: ${url}/login\n  (or, no DNS needed: ${short}/login)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
