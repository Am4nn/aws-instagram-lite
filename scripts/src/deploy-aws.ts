/**
 * npm run deploy:aws: deploy to REAL AWS (stage aws, ap-southeast-2) with your `ig` profile.
 *   0. (--bootstrap, once per account/region) cdk bootstrap
 *   1. open-next build → web/.open-next (the server Lambda's code is a CDK asset, so build before deploying)
 *   2. cdk deploy ig-aws-core -c stage=aws → infra/cdk.out/outputs-aws.json
 *   3. upload .open-next/assets to the web bucket (CloudFront serves /_next/static/* from it)
 * The server reads its settings (API URL, user pool client, Secure cookies, email sign-up) from the
 * Lambda environment that CDK sets: nothing is baked into the build.
 * Options: --bootstrap, --alert-email=you@example.com (or IG_ALERT_EMAIL) for alarm emails.
 * Refuses if AWS_ENDPOINT_URL is set. Profile: AWS_PROFILE (default ig).
 */
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { awsEnv, useAwsEnv, AWS_STAGE_REGION } from "./env.js";
import { cdk, readOutputs } from "./deploy-local.js";
import { buildWeb, publishWeb } from "./web-publish.js";
import { AWS_OUTPUTS_FILE, AWS_STACK, cdkDeployArgs, parseDeployFlags } from "./aws.js";

async function main() {
  const flags = parseDeployFlags(process.argv.slice(2), process.env);
  const env = awsEnv(process.env); // throws if pointed at an emulator
  useAwsEnv();
  console.log(`Real AWS: profile ${env.AWS_PROFILE}, region ${AWS_STAGE_REGION}, stack ${AWS_STACK}`);
  console.log(`(not logged in? run: aws login --profile ${env.AWS_PROFILE})\n`);

  // Bootstraps the environment the app's stack targets: your profile's account + ap-southeast-2.
  if (flags.bootstrap) cdk(["bootstrap", "-c", "stage=aws"], env);
  buildWeb();
  cdk(cdkDeployArgs(flags), env);

  const out = readOutputs(AWS_STACK, AWS_OUTPUTS_FILE);
  if (!out.WebBucket) throw new Error(`stack output WebBucket missing: did the deploy finish?`);
  const r = await publishWeb({ s3: new S3Client({}), bucket: out.WebBucket });
  console.log(`\nUploaded ${r.uploaded} assets (${r.deleted} leftovers removed).`);
  console.log(`Open: https://${out.DistributionDomain}/login  (a fresh distribution can take a few minutes)`);
  if (flags.alertEmail) console.log(`Alarm emails: confirm the subscription mail AWS sent to ${flags.alertEmail}.`);
  console.log("Demo data: npm run seed:aws   Clean up: npm run destroy:aws\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
