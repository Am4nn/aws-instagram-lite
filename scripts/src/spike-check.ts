import { writeFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { fileURLToPath } from "node:url";
import { assertFlociUp, useLocalEnv, FLOCI_ENDPOINT } from "./env.js";
import { cleanStaleStacks } from "./stale.js";
import { cdk, readOutputs } from "./deploy-local.js";
import { renderReport, type CheckResult } from "./report.js";
import * as cognito from "./checks/cognito.js";
import * as s3sqs from "./checks/s3sqs.js";
import * as stepfunctions from "./checks/stepfunctions.js";
import * as eventbridge from "./checks/eventbridge.js";
import * as sns from "./checks/sns.js";
import * as secrets from "./checks/secrets.js";
import * as cloudwatch from "./checks/cloudwatch.js";

const STACK = "ig-local-spike";
const BUCKET = "ig-local-spike-uploads";
const ctx = ["-c", "stage=local", "-c", "spike=true"];
/** No autoDeleteObjects custom resource, so empty the bucket before `cdk destroy`. */
async function emptyBucket(Bucket: string) {
  const s3 = new S3Client({ forcePathStyle: true });
  const listed = await s3.send(new ListObjectsV2Command({ Bucket })).catch((e: Error) => {
    if (e.name === "NoSuchBucket") return { Contents: [] };
    throw e;
  });
  const Contents = listed.Contents ?? [];
  console.log(`Emptying ${Bucket}: ${Contents.length} object(s)`);
  if (Contents.length) {
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: Contents.map((c) => ({ Key: c.Key! })) } }));
  }
}

/** Gotchas found while building step 1. Kept here so every report carries them. */
const SETUP_NOTES = [
  "`cdk bootstrap` and `cdk deploy` work unchanged with `AWS_ENDPOINT_URL=http://localhost:4566`. No cdklocal needed.",
  "CloudFormation outputs give real-AWS URLs (`https://<id>.execute-api.us-east-1.amazonaws.com`). Locally call `http://<id>.execute-api.localhost.floci.io:4566` (public DNS resolves it to 127.0.0.1, so it needs internet).",
  "JWT authorizer + Floci Cognito needs two container env vars: `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true` and `FLOCI_BASE_URL=http://127.0.0.1:4566`. The flag only trusts literal IPs, and the default issuer is `http://localhost:4566/<pool>`, which it rejects with a silent 401. Issuer on real AWS: `https://cognito-idp.<region>.amazonaws.com/<pool>`.",
  "The Floci CLI can't pass env vars, so this repo runs Floci from `docker-compose.yml` (`npm run floci:up`).",
  "`floci reset` wipes resources but keeps CloudFormation stack records, so CDK says \"no changes\" while nothing exists. `npm run deploy:local` detects this (bootstrap SSM param missing) and deletes stale records first.",
  "A stack stuck in `DELETE_FAILED` also makes `cdk deploy` report \"no changes\". The spike tears down before deploying.",
  "CDK `bucket.addEventNotification()` and `autoDeleteObjects` use Lambda-backed custom resources. Avoided: set `NotificationConfiguration` on the bucket directly, and empty buckets before `cdk destroy`.",
  "Lambda runs in Docker (`public.ecr.aws/lambda/nodejs:22`). The first invoke pulls the image (slow once), and warm calls take milliseconds.",
  "CloudWatch alarms are really evaluated (OK → ALARM within about 10 s here, 1-3 min on AWS). SQS metric history outlives `cdk destroy`, so a recreated alarm with the same name can fire right away.",
  "npm 11 blocks esbuild's postinstall script, and esbuild still works without it.",
  "(step 2) Browser → Floci Cognito needs `FLOCI_SECURITY_EXTRA_CORS_ALLOWED_ORIGINS` (+ SDK headers in `..._ALLOWED_HEADERS`). Cognito PreSignUp Lambda triggers work.",
  "(step 3) Inside Lambda, Floci injects `AWS_ENDPOINT_URL=http://localhost.floci.io:4566`; presigned URLs minted there also work from the browser (public DNS → 127.0.0.1). Step Functions retry with jitter + MaxAttempts 0 retriers work.",
  "(step 5) DynamoDB Streams → Lambda with an `eventName: INSERT` filter works (MODIFY correctly filtered out). Floci runs transactions serially, so real-AWS `TransactionConflict` cancellations can't be reproduced locally; the code handles them anyway.",
  "(step 6) `AWS::Logs::LogGroup` with a custom name is reported CREATE_COMPLETE but not created, and Lambda `LoggingConfig.LogGroup` is ignored (logs stay in the Lambda container: `docker logs`). Step Functions `ExecutionsFailed` metrics aren't emitted, so that alarm only fires on AWS. SQS DLQ alarms do work end to end.",
];

const reportPath = fileURLToPath(new URL("../../docs/learn/floci-compat.md", import.meta.url));

async function main() {
  await assertFlociUp();
  useLocalEnv();
  await cleanStaleStacks();
  cdk(["bootstrap", "aws://000000000000/us-east-1", ...ctx]);
  // Pre-clean: a spike stack left from a failed run would make deploy say "no changes".
  await teardown();
  const results: CheckResult[] = [];
  const t0 = Date.now();
  try {
    cdk(["deploy", STACK, ...ctx, "--require-approval", "never", "--outputs-file", "cdk.out/outputs-spike.json"]);
    results.push({
      service: "CloudFormation (CDK)", feature: "cdk bootstrap + deploy of the spike stack",
      ok: true, notes: "plain `cdk deploy`, no cdklocal", ms: Date.now() - t0,
    });
    const o = readOutputs(STACK, "outputs-spike.json");
    for (const mod of [cognito, s3sqs, stepfunctions, eventbridge, sns, secrets, cloudwatch]) {
      for (const r of await mod.run(o)) {
        console.log(`${r.ok ? "✅" : "❌"} ${r.service}: ${r.feature} (${r.ms}ms) ${r.notes}`);
        results.push(r);
      }
    }
  } catch (e) {
    results.push({
      service: "CloudFormation (CDK)", feature: "deploy spike stack",
      ok: false, notes: String((e as Error).message), ms: Date.now() - t0,
    });
  } finally {
    const health = await fetch(`${FLOCI_ENDPOINT}/_floci/health`).then((r) => r.json()).catch(() => ({}));
    writeFileSync(reportPath, renderReport(results, {
      flociVersion: health.version ?? "unknown", date: new Date().toISOString().slice(0, 10),
      setupNotes: SETUP_NOTES,
    }));
    console.log(`\nReport: ${reportPath}`);
    await teardown();
  }
}

async function teardown() {
  await emptyBucket(BUCKET);
  cdk(["destroy", STACK, ...ctx, "--force"]);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
