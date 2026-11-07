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

function synthAws(context: { alertEmail?: string; domainName?: string; certificateArn?: string } = {}) {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const config = loadConfig("aws", {}, context);
  const stack = new CoreStack(app, "ig-aws-core", { config, env: { account: "123456789012", region: config.region } });
  return Template.fromStack(stack);
}

/** `https://<CloudFront domain>`: the only browser origin allowed on aws. */
const cdnOrigin = { "Fn::Join": ["", ["https://", { "Fn::GetAtt": [Match.stringLikeRegexp("^Cdn"), "DomainName"] }]] };

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

  it("allows any browser origin locally (dev server, CloudFront on Floci)", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.objectLike({ AllowOrigins: ["*"] }) });
    t.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "ig-local-uploads-000000000000",
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: ["*"] })] },
    });
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

    it("deletes originals after a day (rejected or abandoned uploads never pile up)", () => {
      t.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "ig-local-uploads-000000000000",
        LifecycleConfiguration: { Rules: [Match.objectLike({ Status: "Enabled", ExpirationInDays: 1, Prefix: "uploads/" })] },
      });
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

    it("retries transient errors with backoff but never retries a bad upload", () => {
      const res = Object.values(t.findResources("AWS::StepFunctions::StateMachine"))[0] as any;
      const parts = res.Properties.DefinitionString["Fn::Join"][1] as unknown[];
      const def = JSON.parse(parts.map((p) => (typeof p === "string" ? p : "TOKEN")).join(""));
      for (const name of ["Validate", "Resize", "Save", "MarkFailed", "Publish"]) {
        const retry = def.States[name].Retry as { ErrorEquals: string[]; MaxAttempts: number; BackoffRate?: number }[];
        expect(retry, name).toBeDefined();
        const last = retry[retry.length - 1];
        expect(last.ErrorEquals, name).toEqual(["States.ALL"]);
        expect(last.MaxAttempts, name).toBeGreaterThanOrEqual(2);
        if (name !== "MarkFailed" && name !== "Publish") {
          expect(retry[0], name).toMatchObject({ ErrorEquals: ["InvalidUploadError"], MaxAttempts: 0 });
        }
      }
      expect(def.States.Publish.Catch, "Publish failure is visible, not silent").toBeDefined();
    });

    it("a rejected upload (user error) ends in Succeed, so the pipeline-failed alarm only means system faults", () => {
      const res = Object.values(t.findResources("AWS::StepFunctions::StateMachine"))[0] as any;
      const parts = res.Properties.DefinitionString["Fn::Join"][1] as unknown[];
      const def = JSON.parse(parts.map((p) => (typeof p === "string" ? p : "TOKEN")).join(""));
      expect(def.States.Rejected.Type).toBe("Succeed");
      expect(def.States.Failed.Type).toBe("Fail");
      expect(def.States.MarkFailed.ResultPath).toBe("$.markFailed"); // keep $.error for the choice
      const choice = def.States[def.States.MarkFailed.Next];
      expect(choice.Type).toBe("Choice");
      expect(JSON.stringify(choice)).toContain("InvalidUploadError");
    });

    it("gives the resize Lambda room for images", () => {
      t.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "ig-local-resize", MemorySize: 1536, Timeout: 30 });
    });

    it("adds the posts routes behind JWT", () => {
      for (const RouteKey of ["POST /posts", "GET /posts/{id}", "GET /users/{userId}/posts"]) {
        t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey, AuthorizationType: "JWT" });
      }
    });
  });

  describe("follow + feed", () => {
    it("keeps the cursor signing key in Secrets Manager", () => {
      t.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "ig-local-cursor-key" });
    });

    it("routes PostPublished + UserFollowed from the bus into the fanout queue (with DLQ)", () => {
      t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "ig-local-fanout", RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) });
      t.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: { "detail-type": ["PostPublished", "UserFollowed"] },
        Targets: [Match.objectLike({ Arn: Match.anyValue() })],
      });
    });

    it("configures feed + fanout with the celeb threshold", () => {
      t.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "ig-local-feed",
        Environment: { Variables: Match.objectLike({ CELEB_THRESHOLD: "3", CURSOR_SECRET_ARN: Match.anyValue() }) },
      });
      t.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "ig-local-fanout", Timeout: 60, Environment: { Variables: Match.objectLike({ CELEB_THRESHOLD: "3" }) },
      });
      t.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "ig-local-social", Environment: { Variables: Match.objectLike({ CELEB_THRESHOLD: "3" }) },
      });
      // one post per invocation: a big fan-out can't time out (and DLQ) its neighbours in the batch
      t.hasResourceProperties("AWS::Lambda::EventSourceMapping", { BatchSize: 1, FunctionName: Match.objectLike({ Ref: Match.stringLikeRegexp("Fnfanout") }) });
    });

    it("adds follow + feed routes behind JWT", () => {
      for (const RouteKey of ["POST /users/{userId}/follow", "DELETE /users/{userId}/follow", "GET /feed"]) {
        t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey, AuthorizationType: "JWT" });
      }
    });
  });

  describe("likes, comments, notifications", () => {
    it("streams new table items (CDC) to the events Lambda, INSERTs only", () => {
      t.hasResourceProperties("AWS::DynamoDB::Table", { StreamSpecification: { StreamViewType: "NEW_IMAGE" } });
      t.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
        FunctionName: Match.anyValue(),
        FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ["INSERT"] }) }] },
        FunctionResponseTypes: ["ReportBatchItemFailures"],
        DestinationConfig: { OnFailure: { Destination: Match.anyValue() } }, // never drop events silently
        MaximumRecordAgeInSeconds: Match.anyValue(),
      });
      t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "ig-local-cdc-dlq" });
      t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "ig-local-cdc-dlq-not-empty" });
    });

    it("routes PostLiked/PostCommented/UserFollowed to the notify queue and has an SNS topic", () => {
      t.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: { "detail-type": ["PostLiked", "PostCommented", "UserFollowed"] },
      });
      t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "ig-local-notify", RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) });
      t.hasResourceProperties("AWS::SNS::Topic", { TopicName: "ig-local-notifications" });
    });

    it("adds like, comment and notification routes behind JWT", () => {
      for (const RouteKey of ["POST /posts/{id}/like", "DELETE /posts/{id}/like", "GET /posts/{id}/comments",
        "POST /posts/{id}/comments", "GET /notifications", "POST /notifications/read"]) {
        t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey, AuthorizationType: "JWT" });
      }
    });
  });

  describe("ops", () => {
    it("alarms on every DLQ and on failed pipeline runs, notifying the ops topic", () => {
      t.hasResourceProperties("AWS::SNS::Topic", { TopicName: "ig-local-ops" });
      for (const q of ["uploads", "fanout", "notify"]) {
        t.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: `ig-local-${q}-dlq-not-empty`, Threshold: 0, ComparisonOperator: "GreaterThanThreshold",
          TreatMissingData: "notBreaching", AlarmActions: [Match.anyValue()],
        });
      }
      t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "ig-local-pipeline-failed", MetricName: "ExecutionsFailed" });
      t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "ig-local-api-5xx", MetricName: "5xx", Threshold: 5 });
    });

    it("has no dashboard locally (real AWS only)", () => {
      t.resourceCountIs("AWS::CloudWatch::Dashboard", 0);
    });

    it("has a local-only inbox queue subscribed to the ops topic", () => {
      t.hasResourceProperties("AWS::SQS::Queue", { QueueName: "ig-local-ops-inbox" });
      t.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "sqs", RawMessageDelivery: true });
    });

    it("gives every function a log group with 2-week retention (no logs kept forever)", () => {
      t.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/ig/ig-local/fanout", RetentionInDays: 14 });
      const fns = Object.keys(t.findResources("AWS::Lambda::Function")).length;
      const groups = Object.keys(t.findResources("AWS::Logs::LogGroup")).length;
      expect(groups).toBeGreaterThanOrEqual(fns - 1); // CDK's own helper functions may not have one
    });
  });

  describe("web hosting (S3 + CloudFront)", () => {
    it("private web bucket served only through CloudFront with Origin Access Control", () => {
      t.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "ig-local-web-000000000000",
        PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
      });
      t.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
      t.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultRootObject: "index.html",
          DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
          CustomErrorResponses: Match.arrayWith([Match.objectLike({ ErrorCode: 404, ResponsePagePath: "/404.html" })]),
        }),
      });
    });
  });

  it("uses no VPC, RDS or custom resources", () => {
    const types = Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);
    expect(types.filter((x) => /^(AWS::EC2::|AWS::RDS::|Custom::|AWS::CloudFormation::CustomResource)/.test(x))).toEqual([]);
  });
});

describe("CoreStack on aws (stage=aws, ap-southeast-2)", () => {
  const t = synthAws();

  it("requires a verified email at sign-up: no auto-confirm trigger", () => {
    t.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "ig-aws-users",
      AutoVerifiedAttributes: ["email"],
      Schema: Match.arrayWith([Match.objectLike({ Name: "email", Required: true })]),
      LambdaConfig: Match.absent(),
    });
    expect(Object.values(t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "ig-aws-presignup" } }))).toEqual([]);
  });

  it("serves a custom domain when configured: CloudFront alias + cert, and CORS allows it", () => {
    const cert = "arn:aws:acm:us-east-1:123456789012:certificate/abc";
    const d = synthAws({ domainName: "lite.amanarya.com", certificateArn: cert });
    d.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["lite.amanarya.com"],
        ViewerCertificate: Match.objectLike({ AcmCertificateArn: cert, SslSupportMethod: "sni-only" }),
      }),
    });
    const both = [cdnOrigin, "https://lite.amanarya.com"];
    d.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.objectLike({ AllowOrigins: both }) });
    d.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedOrigins: both })] },
    });
  });

  it("has one ops dashboard: alarms, API, every Lambda, queues and the pipeline", () => {
    t.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    t.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "ig-aws-ops" });
    const body = JSON.stringify(Object.values(t.findResources("AWS::CloudWatch::Dashboard"))[0]);
    for (const ns of ["AWS/ApiGateway", "AWS/Lambda", "AWS/SQS", "AWS/States"]) expect(body).toContain(ns);
    expect(body).toContain("alarm"); // alarm status widget
    // one Errors line per function (15 on aws: no presignup)
    const fnIds = Object.keys(t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: Match.stringLikeRegexp("^ig-aws-") } }));
    expect(fnIds).toHaveLength(15);
    for (const id of fnIds) expect(body).toContain(`"Ref":"${id}"`);
  });

  it("trusts tokens from Cognito in ap-southeast-2", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      JwtConfiguration: {
        Issuer: Match.objectLike({ "Fn::Join": ["", Match.arrayWith(["https://cognito-idp.ap-southeast-2.amazonaws.com/"])] }),
      },
    });
  });

  it("allows only the CloudFront origin on the API and on browser uploads", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.objectLike({ AllowOrigins: [cdnOrigin] }) });
    t.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "ig-aws-uploads-123456789012",
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedOrigins: [cdnOrigin] })] },
    });
  });

  it("CloudFront: real 404s (OAC may list the bucket), security headers, edges incl. India", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: [Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: "/404.html" })],
        DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() }),
        PriceClass: "PriceClass_200",
      }),
    });
    const policy = JSON.stringify(t.findResources("AWS::S3::BucketPolicy"));
    expect(policy).toContain("s3:ListBucket");
  });

  it("deletes data with the stack (learning project: cdk destroy leaves nothing billable)", () => {
    for (const type of ["AWS::DynamoDB::Table", "AWS::S3::Bucket", "AWS::SecretsManager::Secret", "AWS::Cognito::UserPool"]) {
      for (const [id, r] of Object.entries(t.findResources(type))) expect((r as any).DeletionPolicy, `${type} ${id}`).toBe("Delete");
    }
  });

  it("has no ops inbox queue and no email subscription unless alertEmail is set", () => {
    expect(Object.keys(t.findResources("AWS::SNS::Subscription", { Properties: { Protocol: "email" } }))).toEqual([]);
    expect(Object.keys(t.findResources("AWS::SQS::Queue", { Properties: { QueueName: "ig-aws-ops-inbox" } }))).toEqual([]);
    synthAws({ alertEmail: "me@example.com" }).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email", Endpoint: "me@example.com", TopicArn: { Ref: Match.stringLikeRegexp("^OpsTopic") },
    });
  });

  it("contains no emulator URLs", () => {
    expect(JSON.stringify(t.toJSON())).not.toMatch(/localhost|127\.0\.0\.1|:4566|floci/i);
  });

  it("uses no VPC, RDS or custom resources", () => {
    const types = Object.values(t.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);
    expect(types.filter((x) => /^(AWS::EC2::|AWS::RDS::|Custom::|AWS::CloudFormation::CustomResource)/.test(x))).toEqual([]);
  });
});
