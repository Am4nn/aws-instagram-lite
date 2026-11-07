/**
 * Floci gap (2.4.0): when CloudFormation creates/updates a distribution, Floci drops each behaviour's
 * AllowedMethods, CachePolicyId and OriginRequestPolicyId, so the default behaviour falls back to
 * GET/HEAD only with no cookies and no query strings forwarded ("Invalid method." on every POST).
 * The CloudFront API does keep them, so after each local `cdk deploy` we copy them from the synthesized
 * template onto the live distribution. Real AWS needs none of this (see docs/learn/floci-compat.md).
 */
import { readFileSync } from "node:fs";
import { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand, type DistributionConfig } from "@aws-sdk/client-cloudfront";

type Intended = { AllowedMethods?: string[]; CachePolicyId?: string; OriginRequestPolicyId?: string; PathPattern?: string };
type LiveBehaviour = Record<string, any>;

function patchOne(live: LiveBehaviour, want: Intended): { b: LiveBehaviour; changed: boolean } {
  const methods = want.AllowedMethods ?? ["GET", "HEAD"];
  const b: LiveBehaviour = { ...live };
  let changed = false;
  if (JSON.stringify(b.AllowedMethods?.Items) !== JSON.stringify(methods)) {
    b.AllowedMethods = { Quantity: methods.length, Items: methods, CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } };
    changed = true;
  }
  for (const k of ["CachePolicyId", "OriginRequestPolicyId"] as const) {
    if (want[k] && b[k] !== want[k]) {
      b[k] = want[k];
      changed = true;
    }
  }
  if (b.CachePolicyId && (b.ForwardedValues || b.MinTTL !== undefined)) { // legacy settings conflict with a cache policy
    delete b.ForwardedValues;
    delete b.MinTTL;
    delete b.DefaultTTL;
    delete b.MaxTTL;
    changed = true;
  }
  return { b, changed };
}

/** The live config with the template's behaviour settings applied; `changed` = an update is needed. */
export function patchBehaviours<T extends { DefaultCacheBehavior: LiveBehaviour; CacheBehaviors?: { Quantity: number; Items?: LiveBehaviour[] } }>(
  live: T, intended: { DefaultCacheBehavior: Intended; CacheBehaviors?: Intended[] },
): { config: T; changed: boolean } {
  const def = patchOne(live.DefaultCacheBehavior, intended.DefaultCacheBehavior);
  let changed = def.changed;
  const items = (live.CacheBehaviors?.Items ?? []).map((b) => {
    const want = intended.CacheBehaviors?.find((w) => w.PathPattern === b.PathPattern);
    if (!want) return b;
    const r = patchOne(b, want);
    changed ||= r.changed;
    return r.b;
  });
  const config = { ...live, DefaultCacheBehavior: def.b, ...(live.CacheBehaviors ? { CacheBehaviors: { ...live.CacheBehaviors, Items: items } } : {}) };
  return { config, changed };
}

/** Apply the fix to the deployed local distribution (template = infra/cdk.out/ig-local-core.template.json). */
export async function fixFlociDistribution(distributionId: string, templatePath: string): Promise<boolean> {
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const dist = Object.values(template.Resources as Record<string, any>).find((r) => r.Type === "AWS::CloudFront::Distribution");
  if (!dist) throw new Error("no CloudFront distribution in the template");
  const cf = new CloudFrontClient({});
  const cur = await cf.send(new GetDistributionConfigCommand({ Id: distributionId }));
  const { config, changed } = patchBehaviours(cur.DistributionConfig as any, dist.Properties.DistributionConfig);
  if (!changed) return false;
  await cf.send(new UpdateDistributionCommand({ Id: distributionId, IfMatch: cur.ETag, DistributionConfig: config as DistributionConfig }));
  return true;
}
