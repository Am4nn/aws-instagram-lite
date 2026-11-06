import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CoreStack } from "./core-stack.js";
import { loadConfig } from "./config.js";

function synth() {
  // Skip esbuild bundling in unit tests; the deploy exercises real bundling.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const config = loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" });
  const stack = new CoreStack(app, "ig-local-core", { config });
  return Template.fromStack(stack);
}

describe("CoreStack", () => {
  const t = synth();

  it("has the single table with pk/sk, gsi1, ttl and on-demand billing", () => {
    t.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "ig-local-main",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi1",
          KeySchema: [
            { AttributeName: "gsi1pk", KeyType: "HASH" },
            { AttributeName: "gsi1sk", KeyType: "RANGE" },
          ],
        },
      ],
    });
  });

  it("has the health Lambda on nodejs22.x with STAGE env", () => {
    t.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "ig-local-health",
      Runtime: "nodejs22.x",
      Environment: { Variables: { STAGE: "local" } },
    });
  });

  it("routes GET /health on an HTTP API", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /health" });
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });

  it("uses no VPC, RDS or custom resources", () => {
    const types = Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);
    expect(types.filter((x) => /^(AWS::EC2::|AWS::RDS::|Custom::|AWS::CloudFormation::CustomResource)/.test(x))).toEqual([]);
  });
});
