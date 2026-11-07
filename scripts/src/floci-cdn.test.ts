import { describe, it, expect } from "vitest";
import { patchBehaviours } from "./floci-cdn.js";

const ALL = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"];

// What Floci stores after CloudFormation: policies and methods dropped, legacy ForwardedValues "none".
const live = () => ({
  Comment: "x",
  DefaultCacheBehavior: {
    TargetOriginId: "server", AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
    ForwardedValues: { QueryString: false, Cookies: { Forward: "none" } }, MinTTL: 0,
  },
  CacheBehaviors: { Quantity: 1, Items: [{
    PathPattern: "/media/*", TargetOriginId: "media", AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
    ForwardedValues: { QueryString: false, Cookies: { Forward: "none" } }, MinTTL: 0,
  }] },
});

// What the synthesized template asked for (CloudFormation shape).
const intended = {
  DefaultCacheBehavior: {
    AllowedMethods: ALL, CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", FunctionAssociations: [{ FunctionARN: { "Fn::GetAtt": ["F", "Arn"] } }],
  },
  CacheBehaviors: [{ PathPattern: "/media/*", CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6" }],
};

describe("patchBehaviours (re-apply what Floci's CloudFormation dropped)", () => {
  it("sets methods + cache/origin-request policies on the default behaviour, drops legacy ForwardedValues", () => {
    const { config, changed } = patchBehaviours(live(), intended);
    expect(changed).toBe(true);
    expect(config.DefaultCacheBehavior).toEqual({
      TargetOriginId: "server",
      AllowedMethods: { Quantity: 7, Items: ALL, CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
      CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
      OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
    });
  });

  it("patches path behaviours by PathPattern (GET/HEAD by default)", () => {
    const b = patchBehaviours(live(), intended).config.CacheBehaviors.Items[0];
    expect(b).toMatchObject({ PathPattern: "/media/*", CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6" });
    expect(b.ForwardedValues).toBeUndefined();
  });

  it("is a no-op when everything is already in place", () => {
    const once = patchBehaviours(live(), intended).config;
    expect(patchBehaviours(once, intended).changed).toBe(false);
  });
});
