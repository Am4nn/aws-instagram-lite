/** Pure helpers for the real-AWS scripts (deploy-aws, destroy-aws, seed --stage=aws). */

export const AWS_STACK = "ig-aws-core";
/** Written by `cdk deploy --outputs-file` (inside infra/), read back by deploy/seed. */
export const AWS_OUTPUTS_FILE = "outputs-aws.json";
/** Everything this project creates on AWS starts with this. Scripts never touch anything else. */
export const AWS_PREFIX = "ig-aws-";

export type DeployFlags = { bootstrap: boolean; alertEmail?: string };

/** `npm run deploy:aws -- [--bootstrap] [--alert-email=you@example.com]` (or IG_ALERT_EMAIL). */
export function parseDeployFlags(argv: string[], env: NodeJS.ProcessEnv): DeployFlags {
  const flags: DeployFlags = { bootstrap: false };
  if (env.IG_ALERT_EMAIL) flags.alertEmail = env.IG_ALERT_EMAIL;
  for (const arg of argv) {
    if (arg === "--bootstrap") flags.bootstrap = true;
    else if (arg.startsWith("--alert-email=")) flags.alertEmail = arg.slice("--alert-email=".length);
    else throw new Error(`unknown flag ${arg} (use --bootstrap, --alert-email=<address>)`);
  }
  return flags;
}

export function cdkDeployArgs(flags: DeployFlags): string[] {
  return [
    "deploy", AWS_STACK, "-c", "stage=aws",
    ...(flags.alertEmail ? ["-c", `alertEmail=${flags.alertEmail}`] : []),
    "--require-approval", "never", "--outputs-file", `cdk.out/${AWS_OUTPUTS_FILE}`,
  ];
}

/** Safety net for the destroy script: only buckets named ig-aws-*. */
export function ownBuckets(names: string[]): string[] {
  return names.filter((n) => n.startsWith(AWS_PREFIX));
}

type Version = { Key?: string; VersionId?: string };
type ObjectId = { Key: string; VersionId?: string };

/** DeleteObjects requests (max 1000 keys each) for every object version and delete marker. */
export function deleteBatches(versions: Version[] | undefined, markers: Version[] | undefined): ObjectId[][] {
  const all: ObjectId[] = [...(versions ?? []), ...(markers ?? [])]
    .filter((v): v is ObjectId => !!v.Key)
    .map((v) => (v.VersionId ? { Key: v.Key, VersionId: v.VersionId } : { Key: v.Key }));
  const out: ObjectId[][] = [];
  for (let i = 0; i < all.length; i += 1000) out.push(all.slice(i, i + 1000));
  return out;
}
