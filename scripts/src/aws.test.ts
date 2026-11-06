import { describe, it, expect } from "vitest";
import { AWS_STACK, cdkDeployArgs, deleteBatches, ownBuckets, parseDeployFlags } from "./aws.js";

describe("parseDeployFlags", () => {
  it("defaults: no bootstrap, alert email from IG_ALERT_EMAIL if set", () => {
    expect(parseDeployFlags([], {})).toEqual({ bootstrap: false });
    expect(parseDeployFlags([], { IG_ALERT_EMAIL: "me@x.com" })).toEqual({ bootstrap: false, alertEmail: "me@x.com" });
  });

  it("reads --bootstrap and --alert-email=<addr> (flag wins over env)", () => {
    expect(parseDeployFlags(["--bootstrap", "--alert-email=a@b.co"], { IG_ALERT_EMAIL: "env@x.com" }))
      .toEqual({ bootstrap: true, alertEmail: "a@b.co" });
  });

  it("rejects unknown flags (a typo must not deploy with defaults)", () => {
    expect(() => parseDeployFlags(["--bootstrapp"], {})).toThrow(/unknown flag --bootstrapp/);
  });
});

describe("cdkDeployArgs", () => {
  it("deploys only the aws core stack with outputs written to a file", () => {
    expect(cdkDeployArgs({ bootstrap: false })).toEqual([
      "deploy", "ig-aws-core", "-c", "stage=aws", "--require-approval", "never",
      "--outputs-file", "cdk.out/outputs-aws.json",
    ]);
    expect(AWS_STACK).toBe("ig-aws-core");
  });

  it("passes the alert email as CDK context", () => {
    expect(cdkDeployArgs({ bootstrap: false, alertEmail: "a@b.co" })).toContain("alertEmail=a@b.co");
  });
});

describe("ownBuckets", () => {
  it("keeps only ig-aws-* buckets", () => {
    expect(ownBuckets(["ig-aws-web-1", "ig-local-web-1", "cdk-hnb659fds-assets-1", "ig-aws-media-1", "my-ig-aws-x"]))
      .toEqual(["ig-aws-web-1", "ig-aws-media-1"]);
  });
});

describe("deleteBatches", () => {
  it("deletes every version and delete marker, at most 1000 per request", () => {
    const versions = Array.from({ length: 1500 }, (_, i) => ({ Key: `k${i}`, VersionId: `v${i}` }));
    const markers = [{ Key: "gone", VersionId: "m1" }];
    const batches = deleteBatches(versions, markers);
    expect(batches.map((b) => b.length)).toEqual([1000, 501]);
    expect(batches[1].at(-1)).toEqual({ Key: "gone", VersionId: "m1" });
  });

  it("handles unversioned buckets (VersionId null) and empty listings", () => {
    expect(deleteBatches([{ Key: "a", VersionId: "null" }, { Key: "b" }], [])).toEqual([[{ Key: "a", VersionId: "null" }, { Key: "b" }]]);
    expect(deleteBatches(undefined, undefined)).toEqual([]);
  });
});
