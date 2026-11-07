import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFlociUp, localEnv, useLocalEnv } from "./env.js";
import { devEnvFile, localApiUrl, localCdnUrl } from "./urls.js";
import { cleanStaleStacks } from "./stale.js";
import { fixFlociDistribution } from "./floci-cdn.js";

export const infraDir = fileURLToPath(new URL("../../infra/", import.meta.url));
const webEnvPath = fileURLToPath(new URL("../../web/.env.development.local", import.meta.url));
/** Before step 9 the browser build read web/.env.local; Next also loads it for production builds, so it must go. */
const oldWebEnvPath = fileURLToPath(new URL("../../web/.env.local", import.meta.url));

/** Run the CDK CLI inside infra/ (default: with Floci env vars). Throws on non-zero exit. */
export function cdk(args: string[], env: NodeJS.ProcessEnv = localEnv(process.env)): void {
  // Run the CLI through node directly: no shell, so the space in the path is safe.
  const cdkBin = createRequire(`${infraDir}package.json`).resolve("aws-cdk/bin/cdk");
  const res = spawnSync(process.execPath, [cdkBin, ...args], {
    cwd: infraDir,
    env,
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error(`cdk ${args[0]} failed (exit ${res.status})`);
}

/**
 * `cdk deploy ig-local-core` args. Once the stack exists, its local CloudFront URL is passed as context so
 * the web server accepts it as the site origin (Floci runs no CloudFront Functions, see infra/lib/web.ts).
 */
export function localDeployArgs(): string[] {
  let domain: string | undefined;
  try {
    domain = readOutputs("ig-local-core").DistributionDomain;
  } catch { /* first deploy: no outputs yet */ }
  const cdn = domain ? localCdnUrl(domain) : undefined;
  return [
    "deploy", "ig-local-core", "-c", "stage=local", ...(cdn ? ["-c", `localSiteOrigin=${cdn}`] : []),
    "--require-approval", "never", "--outputs-file", "cdk.out/outputs-local.json",
  ];
}

/** cdk deploy ig-local-core, then re-apply the CloudFront behaviour settings Floci's CloudFormation drops. */
export async function deployLocalStack(): Promise<Record<string, string>> {
  cdk(localDeployArgs());
  const out = readOutputs("ig-local-core");
  if (await fixFlociDistribution(out.DistributionId, `${infraDir}cdk.out/ig-local-core.template.json`)) {
    console.log("Floci: re-applied CloudFront methods + cache/origin-request policies (see floci-compat.md)");
  }
  return out;
}

export function readOutputs(stack: string, file = "outputs-local.json"): Record<string, string> {
  const all = JSON.parse(readFileSync(`${infraDir}cdk.out/${file}`, "utf8"));
  return all[stack] ?? {};
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const stale = await cleanStaleStacks();
  if (stale.length) console.log(`Floci was reset; removed stale stack records: ${stale.join(", ")}`);
  cdk(["bootstrap", "aws://000000000000/us-east-1", "-c", "stage=local"]);
  const out = await deployLocalStack();
  const api = localApiUrl(out.ApiUrl);
  writeFileSync(webEnvPath, devEnvFile({ apiUrl: api, userPoolClientId: out.UserPoolClientId, mediaBucket: out.MediaBucket }));
  rmSync(oldWebEnvPath, { force: true });
  console.log(`\nLocal API: ${api}\nTry: curl ${api}/health`);
  console.log("Wrote web/.env.development.local. Next: npm run deploy:web (the site on Floci's CloudFront), or npm -w web run dev\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
