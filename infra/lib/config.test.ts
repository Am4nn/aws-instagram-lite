import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const FLOCI = { AWS_ENDPOINT_URL: "http://localhost:4566" };

describe("loadConfig", () => {
  it("builds the local stage when pointed at Floci", () => {
    expect(loadConfig("local", FLOCI)).toEqual({
      stage: "local", prefix: "ig-local", celebThreshold: 3, isLocal: true,
      cognitoIssuerBase: "http://127.0.0.1:4566",
    });
  });

  it("accepts the *.floci.io endpoint floci env prints", () => {
    expect(loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost.floci.io:4566" }).isLocal).toBe(true);
  });

  it("builds the aws stage with no endpoint override", () => {
    expect(loadConfig("aws", {})).toEqual({
      stage: "aws", prefix: "ig-aws", celebThreshold: 10000, isLocal: false,
    });
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
