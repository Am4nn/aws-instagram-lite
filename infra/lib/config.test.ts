import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const FLOCI = { AWS_ENDPOINT_URL: "http://localhost:4566" };

describe("loadConfig", () => {
  it("builds the local stage when pointed at Floci", () => {
    expect(loadConfig("local", FLOCI)).toEqual({
      stage: "local", prefix: "ig-local", celebThreshold: 3, isLocal: true, region: "us-east-1",
      cognitoIssuerBase: "http://127.0.0.1:4566",
    });
  });

  it("accepts the *.floci.io endpoint floci env prints", () => {
    expect(loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost.floci.io:4566" }).isLocal).toBe(true);
  });

  it("builds the aws stage in ap-southeast-2 with no endpoint override", () => {
    expect(loadConfig("aws", {})).toEqual({
      stage: "aws", prefix: "ig-aws", celebThreshold: 10000, isLocal: false, region: "ap-southeast-2",
    });
  });

  it("takes an optional ops alert email on aws (context wins over IG_ALERT_EMAIL)", () => {
    expect(loadConfig("aws", { IG_ALERT_EMAIL: "me@x.com" }).alertEmail).toBe("me@x.com");
    expect(loadConfig("aws", { IG_ALERT_EMAIL: "env@x.com" }, { alertEmail: "ctx@x.com" }).alertEmail).toBe("ctx@x.com");
    expect(() => loadConfig("aws", {}, { alertEmail: "not-an-email" })).toThrow(/alertEmail/);
  });

  it("takes an optional custom domain on aws, with its us-east-1 certificate", () => {
    const cert = "arn:aws:acm:us-east-1:123456789012:certificate/abc";
    expect(loadConfig("aws", {}, { domainName: "lite.amanarya.com", certificateArn: cert }))
      .toMatchObject({ domainName: "lite.amanarya.com", certificateArn: cert });
    expect(() => loadConfig("aws", {}, { domainName: "lite.amanarya.com" })).toThrow(/certificateArn/);
    expect(() => loadConfig("aws", {}, { domainName: "lite.amanarya.com", certificateArn: cert.replace("us-east-1", "ap-southeast-2") }))
      .toThrow(/us-east-1/);
  });

  it("refuses local without a Floci endpoint (would hit real AWS)", () => {
    expect(() => loadConfig("local", {})).toThrow(/AWS_ENDPOINT_URL must point at Floci/);
    expect(() => loadConfig("local", { AWS_ENDPOINT_URL: "https://s3.amazonaws.com" }))
      .toThrow(/AWS_ENDPOINT_URL must point at Floci/);
  });

  it("refuses aws while an endpoint override is set", () => {
    expect(() => loadConfig("aws", FLOCI)).toThrow(/unset AWS_ENDPOINT_URL/);
  });

  it("refuses unknown or missing stage", () => {
    expect(() => loadConfig(undefined, FLOCI)).toThrow(/stage must be local or aws/);
    expect(() => loadConfig("prod", FLOCI)).toThrow(/stage must be local or aws/);
  });
});
