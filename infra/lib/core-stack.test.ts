import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { CoreStack } from "./core-stack.js";
import { loadConfig } from "./config.js";
import { WEB_PLACEHOLDER } from "./web.js";

function synth() {
  // Skip esbuild bundling in unit tests; the deploy exercises real bundling.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const config = loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" });
  const stack = new CoreStack(app, "ig-local-core", {
    config, env: { account: "000000000000", region: "us-east-1" }, webServerBundle: WEB_PLACEHOLDER,
  });
  return Template.fromStack(stack);
}

function synthAws(context: { alertEmail?: string; domainName?: string; certificateArn?: string } = {}) {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const config = loadConfig("aws", {}, context);
  const stack = new CoreStack(app, "ig-aws-core", {
    config, env: { account: "123456789012", region: config.region }, webServerBundle: WEB_PLACEHOLDER,
  });
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

  it("API has no CORS (only the Next.js server calls it); browser uploads allow any origin locally", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.absent() });
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

  describe("web hosting (SSR Lambda + S3 + CloudFront)", () => {
    const dist = () => (Object.values(t.findResources("AWS::CloudFront::Distribution"))[0] as any).Properties.DistributionConfig;
    const originOf = (behaviour: { TargetOriginId: string }) => dist().Origins.find((o: any) => o.Id === behaviour.TargetOriginId);

    it("server Lambda: Node 22, 1024 MB, public Function URL (authType NONE), its own log group", () => {
      t.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "ig-local-web-server", Runtime: "nodejs22.x", MemorySize: 1024, Handler: "index.handler",
        Environment: { Variables: Match.objectLike({
          STAGE: "local", SECURE_COOKIES: "false", SIGNUP_EMAIL: "", ORIGIN_VERIFY_SECRET: Match.anyValue(),
          API_URL: Match.objectLike({ "Fn::Join": ["", Match.arrayWith(["http://", ".execute-api.localhost.floci.io:4566"])] }),
          USER_POOL_CLIENT_ID: Match.anyValue(), COGNITO_REGION: "us-east-1",
        }) },
      });
      t.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
      t.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/ig/ig-local/web-server", RetentionInDays: 14 });
    });

    it("three behaviours: /_next/static/* to the web bucket, /media/* to the media bucket, the rest to the server", () => {
      const d = dist();
      const byPath = Object.fromEntries(d.CacheBehaviors.map((b: any) => [b.PathPattern, b]));
      expect(Object.keys(byPath).sort()).toEqual(["/_next/static/*", "/media/*"]);
      expect(JSON.stringify(originOf(byPath["/_next/static/*"]).DomainName)).toMatch(/Web/);
      expect(JSON.stringify(originOf(byPath["/media/*"]).DomainName)).toMatch(/Media/);
      for (const b of Object.values(byPath) as any[]) {
        expect(b.CachePolicyId).toBe("658327ea-f89d-4fab-a63d-7e88639e58f6"); // CachingOptimized
        expect(originOf(b).OriginAccessControlId).toBeDefined();
      }
      expect(d.DefaultCacheBehavior).toMatchObject({
        CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // CachingDisabled: pages are personal
        OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", // AllViewerExceptHostHeader: cookies + query
        AllowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
        ViewerProtocolPolicy: "redirect-to-https",
      });
      expect(d.DefaultCacheBehavior.FunctionAssociations[0].EventType).toBe("viewer-request");
      t.resourceCountIs("AWS::CloudFront::OriginAccessControl", 2);
      expect(d.DefaultRootObject).toBeUndefined();
      expect(d.CustomErrorResponses).toBeUndefined();
    });

    it("the server origin gets the secret x-origin-verify header (same value as the Lambda env)", () => {
      const server = originOf(dist().DefaultCacheBehavior);
      const header = server.OriginCustomHeaders.find((h: any) => h.HeaderName === "x-origin-verify");
      const fn = Object.values(t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "ig-local-web-server" } }))[0] as any;
      expect(header.HeaderValue).toEqual(fn.Properties.Environment.Variables.ORIGIN_VERIFY_SECRET);
      expect(JSON.stringify(header.HeaderValue)).toContain("AWS::StackId");
    });

    it("Floci: the server origin is the Function URL host on localhost.floci.io, plain http on 4566", () => {
      const server = originOf(dist().DefaultCacheBehavior);
      expect(JSON.stringify(server.DomainName)).toContain(".lambda-url.us-east-1.localhost.floci.io");
      expect(server.CustomOriginConfig).toMatchObject({ OriginProtocolPolicy: "http-only", HTTPPort: 4566 });
    });

    it("Floci runs no CloudFront Functions: the local CloudFront URL (context) is an allowed site origin", () => {
      const app = new App({ context: { "aws:cdk:bundling-stacks": [], localSiteOrigin: "http://d1.cloudfront.localhost.floci.io:4566" } });
      const config = loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" });
      const stack = new CoreStack(app, "ig-local-core", { config, env: { account: "000000000000", region: "us-east-1" }, webServerBundle: WEB_PLACEHOLDER });
      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "ig-local-web-server",
        Environment: { Variables: Match.objectLike({ SITE_ORIGINS: "http://d1.cloudfront.localhost.floci.io:4566" }) },
      });
    });

    it("a CloudFront Function copies the viewer Host into x-forwarded-host", () => {
      t.hasResourceProperties("AWS::CloudFront::Function", { FunctionCode: Match.stringLikeRegexp("x-forwarded-host") });
    });

    it("private buckets; the media bucket only readable by CloudFront", () => {
      t.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "ig-local-web-000000000000",
        PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
      });
      const policies = JSON.stringify(t.findResources("AWS::S3::BucketPolicy"));
      expect(policies).toContain("cloudfront.amazonaws.com");
      expect(policies).toMatch(/Media/);
    });

    it("the posts and feed Lambdas no longer read the media bucket (no presigned GETs)", () => {
      for (const name of ["ig-local-posts", "ig-local-feed"]) {
        const fn = Object.values(t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: name } }))[0] as any;
        expect(fn.Properties.Environment.Variables.MEDIA_BUCKET, name).toBeUndefined();
      }
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

  it("serves a custom domain when configured: CloudFront alias + cert, uploads CORS + the server allow it", () => {
    const cert = "arn:aws:acm:us-east-1:123456789012:certificate/abc";
    const d = synthAws({ domainName: "lite.amanarya.com", certificateArn: cert });
    d.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["lite.amanarya.com"],
        ViewerCertificate: Match.objectLike({ AcmCertificateArn: cert, SslSupportMethod: "sni-only" }),
      }),
    });
    const both = [cdnOrigin, "https://lite.amanarya.com"];
    d.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedOrigins: both })] },
    });
    d.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "ig-aws-web-server",
      Environment: { Variables: Match.objectLike({ SITE_ORIGINS: "https://lite.amanarya.com" }) },
    });
  });

  it("has one ops dashboard: alarms, API, every Lambda, queues and the pipeline", () => {
    t.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    t.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "ig-aws-ops" });
    const body = JSON.stringify(Object.values(t.findResources("AWS::CloudWatch::Dashboard"))[0]);
    for (const ns of ["AWS/ApiGateway", "AWS/Lambda", "AWS/SQS", "AWS/States"]) expect(body).toContain(ns);
    expect(body).toContain("alarm"); // alarm status widget
    // one Errors line per function (16 on aws: no presignup, plus the web server)
    const fnIds = Object.keys(t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: Match.stringLikeRegexp("^ig-aws-") } }));
    expect(fnIds).toHaveLength(16);
    for (const id of fnIds) expect(body).toContain(`"Ref":"${id}"`);
  });

  it("trusts tokens from Cognito in ap-southeast-2", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      JwtConfiguration: {
        Issuer: Match.objectLike({ "Fn::Join": ["", Match.arrayWith(["https://cognito-idp.ap-southeast-2.amazonaws.com/"])] }),
      },
    });
  });

  it("API has no CORS at all; browser uploads only from the CloudFront origin", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.absent() });
    t.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "ig-aws-uploads-123456789012",
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedOrigins: [cdnOrigin] })] },
    });
  });

  it("CloudFront: security headers on every behaviour, edges incl. India", () => {
    const d = (Object.values(t.findResources("AWS::CloudFront::Distribution"))[0] as any).Properties.DistributionConfig;
    expect(d.PriceClass).toBe("PriceClass_200");
    for (const b of [d.DefaultCacheBehavior, ...d.CacheBehaviors]) expect(b.ResponseHeadersPolicyId).toBeDefined();
  });

  it("SSR server on aws: Secure cookies, email sign-up, real Function URL origin over https", () => {
    t.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "ig-aws-web-server",
      Environment: { Variables: Match.objectLike({
        SECURE_COOKIES: "true", SIGNUP_EMAIL: "required", COGNITO_REGION: "ap-southeast-2",
        API_URL: { "Fn::GetAtt": [Match.stringLikeRegexp("^Api"), "ApiEndpoint"] },
      }) },
    });
    const d = (Object.values(t.findResources("AWS::CloudFront::Distribution"))[0] as any).Properties.DistributionConfig;
    const server = d.Origins.find((o: any) => o.Id === d.DefaultCacheBehavior.TargetOriginId);
    expect(server.CustomOriginConfig.OriginProtocolPolicy).toBe("https-only");
    expect(server.OriginCustomHeaders.map((h: any) => h.HeaderName)).toEqual(["x-origin-verify"]);
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
