import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { CoreStack } from "./core-stack.js";
import { loadConfig } from "./config.js";

function synth() {
  // Skip esbuild bundling in unit tests; the deploy exercises real bundling.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const config = loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" });
  const stack = new CoreStack(app, "ig-local-core", { config, env: { account: "000000000000", region: "us-east-1" } });
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

  it("has a Cognito user pool that auto-confirms via a PreSignUp trigger", () => {
    t.resourceCountIs("AWS::Cognito::UserPool", 1);
    t.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "ig-local-users",
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
    t.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "ig-local-presignup" });
  });

  it("protects routes with a JWT authorizer whose issuer is Floci's local Cognito", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      JwtConfiguration: {
        Issuer: Match.objectLike({ "Fn::Join": ["", Match.arrayWith(["http://127.0.0.1:4566/"])] }),
      },
    });
  });

  it("exposes the profile routes behind the JWT authorizer, health stays public", () => {
    for (const RouteKey of ["GET /me", "PUT /me", "GET /users/{username}"]) {
      t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey, AuthorizationType: "JWT" });
    }
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /health", AuthorizationType: "NONE" });
  });

  describe("upload pipeline", () => {
    it("uploads bucket (globally unique name) notifies SQS natively and allows browser PUTs", () => {
      t.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "ig-local-uploads-000000000000",
        NotificationConfiguration: { QueueConfigurations: [Match.objectLike({ Event: "s3:ObjectCreated:*" })] },
        CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: Match.arrayWith(["PUT"]) })] },
      });
      t.hasResourceProperties("AWS::S3::Bucket", { BucketName: "ig-local-media-000000000000" });
    });

    it("uploads queue sends poison messages to a DLQ after 3 tries", () => {
      t.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "ig-local-uploads",
        RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
      });
      t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "ig-local-uploads-dlq" });
    });

    it("has a state machine with a catch path, plus the event bus", () => {
      const machines = t.findResources("AWS::StepFunctions::StateMachine");
      const def = JSON.stringify(Object.values(machines)[0]);
      for (const s of ["Validate", "Resize", "Save", "Publish", "MarkFailed", "Catch"]) expect(def).toContain(s);
      t.hasResourceProperties("AWS::Events::EventBus", { Name: "ig-local-bus" });
    });

    it("gives the resize Lambda room for images", () => {
      t.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "ig-local-resize", MemorySize: 1024, Timeout: 30 });
    });

    it("adds the posts routes behind JWT", () => {
      for (const RouteKey of ["POST /posts", "GET /posts/{id}", "GET /users/{userId}/posts"]) {
        t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey, AuthorizationType: "JWT" });
      }
    });
  });

  it("uses no VPC, RDS or custom resources", () => {
    const types = Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);
    expect(types.filter((x) => /^(AWS::EC2::|AWS::RDS::|Custom::|AWS::CloudFormation::CustomResource)/.test(x))).toEqual([]);
  });
});
