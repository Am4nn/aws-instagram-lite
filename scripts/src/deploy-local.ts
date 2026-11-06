import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFlociUp, localEnv, useLocalEnv } from "./env.js";
import { localApiUrl, webEnvFile } from "./urls.js";
import { cleanStaleStacks } from "./stale.js";

export const infraDir = fileURLToPath(new URL("../../infra/", import.meta.url));
const webEnvPath = fileURLToPath(new URL("../../web/.env.local", import.meta.url));

/** Run the CDK CLI inside infra/ with Floci env vars. Throws on non-zero exit. */
export function cdk(args: string[]): void {
  // Run the CLI through node directly: no shell, so the space in the path is safe.
  const cdkBin = createRequire(`${infraDir}package.json`).resolve("aws-cdk/bin/cdk");
  const res = spawnSync(process.execPath, [cdkBin, ...args], {
    cwd: infraDir,
    env: localEnv(process.env),
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error(`cdk ${args[0]} failed (exit ${res.status})`);
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
  cdk([
    "deploy", "ig-local-core", "-c", "stage=local",
    "--require-approval", "never", "--outputs-file", "cdk.out/outputs-local.json",
  ]);
  const api = localApiUrl(readOutputs("ig-local-core").ApiUrl);
  writeFileSync(webEnvPath, webEnvFile(api));
  console.log(`\nLocal API: ${api}\nTry: curl ${api}/health\nWrote web/.env.local, now run: npm -w web run dev\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
