/**
 * npm run destroy:aws: remove the REAL AWS stack (stage aws) so nothing keeps billing.
 *   1. empty every ig-aws-* bucket of the stack (all versions + delete markers): CloudFormation
 *      can't delete a bucket that still has objects
 *   2. cdk destroy ig-aws-core -c stage=aws --force
 *   3. force-delete the cursor secret if Secrets Manager only scheduled it for deletion
 *      (otherwise a redeploy within 7-30 days fails on the name)
 * Never touches anything outside the ig-aws- prefix. The CDK bootstrap stack (CDKToolkit) stays.
 */
import { fileURLToPath } from "node:url";
import { CloudFormationClient, paginateListStackResources } from "@aws-sdk/client-cloudformation";
import { S3Client, DeleteObjectsCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import { awsEnv, useAwsEnv, AWS_STAGE_REGION } from "./env.js";
import { cdk } from "./deploy-local.js";
import { AWS_PREFIX, AWS_STACK, deleteBatches, ownBuckets } from "./aws.js";

/** Physical names of the stack's buckets, or [] if the stack doesn't exist. */
async function stackBuckets(): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const page of paginateListStackResources({ client: new CloudFormationClient({}) }, { StackName: AWS_STACK })) {
      for (const r of page.StackResourceSummaries ?? []) {
        if (r.ResourceType === "AWS::S3::Bucket" && r.PhysicalResourceId) names.push(r.PhysicalResourceId);
      }
    }
  } catch (e) {
    if (/does not exist/.test(String((e as Error).message))) return [];
    throw e;
  }
  return ownBuckets(names);
}

async function emptyBucket(s3: S3Client, bucket: string): Promise<number> {
  let n = 0;
  try {
    // Works for unversioned buckets too (every object has VersionId "null").
    let KeyMarker: string | undefined;
    let VersionIdMarker: string | undefined;
    do {
      const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker, VersionIdMarker }));
      for (const Objects of deleteBatches(page.Versions, page.DeleteMarkers)) {
        const r = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
        if (r.Errors?.length) throw new Error(`${bucket}: could not delete ${r.Errors[0].Key}: ${r.Errors[0].Message}`);
        n += Objects.length;
      }
      KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (KeyMarker);
  } catch (e) {
    if ((e as Error).name === "NoSuchBucket") return 0;
    throw e;
  }
  return n;
}

async function main() {
  const env = awsEnv(process.env); // throws if pointed at an emulator
  useAwsEnv();
  console.log(`Real AWS: profile ${env.AWS_PROFILE}, region ${AWS_STAGE_REGION}. Destroying ${AWS_STACK}…`);

  const s3 = new S3Client({});
  for (const bucket of await stackBuckets()) console.log(`Emptied ${bucket} (${await emptyBucket(s3, bucket)} objects)`);

  cdk(["destroy", AWS_STACK, "-c", "stage=aws", "--force"], env);

  const secret = `${AWS_PREFIX}cursor-key`;
  try {
    await new SecretsManagerClient({}).send(new DeleteSecretCommand({ SecretId: secret, ForceDeleteWithoutRecovery: true }));
    console.log(`Force-deleted secret ${secret}`);
  } catch (e) {
    if ((e as Error).name !== "ResourceNotFoundException") throw e;
  }
  console.log("\nDone. The CDKToolkit bootstrap stack stays (cents/month); check Billing tomorrow.\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
