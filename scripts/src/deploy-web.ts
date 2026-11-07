/**
 * npm run deploy:web: build the Next.js app with OpenNext and run it on Floci (local stage).
 *   1. open-next build → web/.open-next (server Lambda bundle + static assets)
 *   2. cdk deploy ig-local-core: the web-server Lambda gets the new bundle
 *   3. upload .open-next/assets to the web bucket (CloudFront serves /_next/static/* from there)
 *   4. .env: WEB_ORIGIN (Floci CORS for browser → S3 uploads) + SSR_ORIGIN_HOST (Floci's CloudFront may
 *      only proxy to hosts listed exactly) → recreate the Floci container if it changed (state persists)
 * Real AWS: npm run deploy:aws (same build + publish).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { deployLocalStack } from "./deploy-local.js";
import { flociEnvFile, localCdnUrl, ssrOriginHost } from "./urls.js";
import { buildWeb, publishWeb } from "./web-publish.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

export { localCdnUrl } from "./urls.js";

/** Right after a container recreate the port can need a few more seconds. */
async function waitForFloci() {
  for (let i = 0; ; i++) {
    try {
      return await assertFlociUp();
    } catch (e) {
      if (i >= 15) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  buildWeb();
  const out = await deployLocalStack();
  const url = localCdnUrl(out.DistributionDomain);
  const r = await publishWeb({ s3: new S3Client({ forcePathStyle: true }), bucket: out.WebBucket });
  console.log(`Uploaded ${r.uploaded} assets (${r.deleted} leftovers removed).`);

  const envFile = join(root, ".env");
  const wanted = flociEnvFile({ webOrigin: url, ssrOriginHost: ssrOriginHost(out.ServerFunctionUrl) });
  if (!existsSync(envFile) || readFileSync(envFile, "utf8") !== wanted) {
    writeFileSync(envFile, wanted);
    console.log("Floci settings changed (.env): recreating the container…");
    const d = spawnSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit" });
    if (d.status !== 0) throw new Error("docker compose up failed");
    await waitForFloci();
  }
  const short = url.replace(".localhost.floci.io", ".localhost");
  console.log(`\nOpen: ${url}/login\n  (or, no DNS needed: ${short}/login)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
