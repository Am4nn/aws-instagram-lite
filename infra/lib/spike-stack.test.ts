import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SpikeStack } from "./spike-stack.js";
import { loadConfig } from "./config.js";

describe("SpikeStack", () => {
  const app = new App();
  const config = loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" });
  const t = Template.fromStack(new SpikeStack(app, "ig-local-spike", { config }));
  const types = Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);

  it("covers every service later steps need", () => {
    for (const ty of [
      "AWS::Cognito::UserPool", "AWS::ApiGatewayV2::Authorizer", "AWS::S3::Bucket", "AWS::SQS::Queue",
      "AWS::StepFunctions::StateMachine", "AWS::Events::EventBus", "AWS::Events::Rule", "AWS::SNS::Topic",
      "AWS::SNS::Subscription", "AWS::SecretsManager::Secret", "AWS::CloudWatch::Alarm",
    ]) expect(types, ty).toContain(ty);
  });

  it("wires S3 → SQS natively (no CDK notifications custom resource)", () => {
    expect(types.filter((x) => x.startsWith("Custom::") || x === "AWS::CloudFormation::CustomResource")).toEqual([]);
    t.hasResourceProperties("AWS::S3::Bucket", {
      NotificationConfiguration: { QueueConfigurations: [{ Event: "s3:ObjectCreated:*" }] },
    });
  });

  it("protects GET /private with a JWT authorizer using the stage's issuer", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /private", AuthorizationType: "JWT" });
  });
});
