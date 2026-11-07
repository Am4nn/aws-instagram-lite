import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, Fn, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import type { CoreStack } from "./core-stack.js";

/** The server bundle `npx open-next build` writes (web/.open-next/server-functions/default). */
export const WEB_SERVER_BUNDLE = fileURLToPath(new URL("../../web/.open-next/server-functions/default", import.meta.url));
/** Stand-in Lambda code (answers 503) until the web app has been built once. */
export const WEB_PLACEHOLDER = fileURLToPath(new URL("../assets/web-placeholder", import.meta.url));

/** Copies the viewer's Host header into x-forwarded-host, so the Next.js server knows its public origin. */
const FORWARDED_HOST_FN = `function handler(event) {
  var r = event.request;
  if (r.headers.host) r.headers["x-forwarded-host"] = { value: r.headers.host.value };
  return r;
}`;

/**
 * Web hosting (step 9): Next.js rendered on the server, all behind ONE CloudFront distribution:
 *   /_next/static/*  → S3 web bucket (OAC)      hashed JS/CSS/fonts, cached for a year
 *   /media/*         → S3 media bucket (OAC)    thumbs + full JPEGs from the upload pipeline
 *   everything else  → Lambda "web-server"      OpenNext bundle behind a Function URL, never cached
 * The Function URL is public (authType NONE) but useless without the secret header CloudFront adds
 * (`x-origin-verify`, checked by web/proxy.ts). Assets are uploaded by deploy:web / deploy:aws (SDK PutObject).
 */
export function addWeb(stack: CoreStack, o: {
  media: s3.IBucket; apiUrl: string; userPoolClientId: string; serverBundle?: string;
}) {
  const { prefix, isLocal, domainName, certificateArn, stage } = stack.stageConfig;

  const bucket = new s3.Bucket(stack, "Web", {
    bucketName: `${prefix}-web-${stack.account}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: !isLocal,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  // Random per stack and stable for its life: the UUID at the end of the stack's own ARN. Only CloudFront
  // (origin header) and the Lambda (env) are given it.
  const originSecret = Fn.select(2, Fn.split("/", stack.stackId));

  // ---------- the Next.js server ----------
  const bundle = o.serverBundle ?? (existsSync(WEB_SERVER_BUNDLE) ? WEB_SERVER_BUNDLE : WEB_PLACEHOLDER);
  const logGroup = new logs.LogGroup(stack, "Logs-web-server", {
    logGroupName: `/ig/${prefix}/web-server`,
    retention: logs.RetentionDays.TWO_WEEKS,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  const server = new lambda.Function(stack, "WebServer", {
    functionName: `${prefix}-web-server`,
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: lambda.Code.fromAsset(bundle),
    memorySize: 1024, // more memory = more CPU = faster renders and cold starts
    timeout: Duration.seconds(15),
    logGroup,
    environment: {
      STAGE: stage,
      API_URL: o.apiUrl,
      USER_POOL_CLIENT_ID: o.userPoolClientId,
      COGNITO_REGION: stack.region,
      SIGNUP_EMAIL: isLocal ? "" : "required", // aws: email + confirmation code at sign-up
      SECURE_COOKIES: isLocal ? "false" : "true", // Floci serves plain http
      SITE_ORIGINS: domainName ? `https://${domainName}` : "",
      ORIGIN_VERIFY_SECRET: originSecret,
    },
  });
  stack.functions["web-server"] = server;
  const url = server.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

  const customHeaders = { "x-origin-verify": originSecret };
  const serverOrigin = isLocal
    // Floci returns http://<id>.lambda-url.us-east-1.127.0.0.1:4566/, which doesn't resolve; its CloudFront
    // reaches the same URL as <id>.lambda-url.us-east-1.localhost.floci.io (see floci-compat.md).
    ? new origins.HttpOrigin(
      Fn.join("", [Fn.select(0, Fn.split(".", Fn.select(2, Fn.split("/", url.url)))), ".lambda-url.us-east-1.localhost.floci.io"]),
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY, httpPort: 4566, customHeaders },
    )
    : new origins.FunctionUrlOrigin(url, { customHeaders });

  // ---------- CloudFront ----------
  const securityHeaders = isLocal ? {} : { responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS };
  const s3Behaviour = (b: s3.IBucket): cloudfront.BehaviorOptions => ({
    origin: origins.S3BucketOrigin.withOriginAccessControl(b),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // honours each object's Cache-Control
    compress: true,
    ...securityHeaders,
  });
  const forwardedHost = new cloudfront.Function(stack, "ForwardedHost", {
    functionName: `${prefix}-forwarded-host`,
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(FORWARDED_HOST_FN),
  });

  const distribution = new cloudfront.Distribution(stack, "Cdn", {
    comment: `${prefix} web`,
    // aws, optional: custom domain. The cert was requested once by CLI in us-east-1 (this stack can't deploy there).
    ...(domainName && certificateArn ? {
      domainNames: [domainName],
      certificate: acm.Certificate.fromCertificateArn(stack, "SiteCert", certificateArn),
    } : {}),
    defaultBehavior: {
      origin: serverOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // pages + /bff/* POST/PUT/DELETE
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // every page is personal
      // all viewer headers (cookies, query strings, Origin) except Host: a Function URL only answers to its own host
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: [{ function: forwardedHost, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      ...securityHeaders,
    },
    additionalBehaviors: {
      "/_next/static/*": s3Behaviour(bucket),
      "/media/*": s3Behaviour(o.media),
    },
    // local: cheapest edge set (NA + EU). aws: PRICE_CLASS_200 adds Asia incl. India, where the users are (the stack itself is in Sydney).
    priceClass: isLocal ? cloudfront.PriceClass.PRICE_CLASS_100 : cloudfront.PriceClass.PRICE_CLASS_200,
  });

  /** Browser origins of the site (aws): the CloudFront domain + the custom domain. */
  const siteOrigins = [`https://${distribution.distributionDomainName}`, ...(domainName ? [`https://${domainName}`] : [])];

  new CfnOutput(stack, "WebBucket", { value: bucket.bucketName });
  new CfnOutput(stack, "DistributionId", { value: distribution.distributionId });
  new CfnOutput(stack, "DistributionDomain", { value: distribution.distributionDomainName });
  new CfnOutput(stack, "ServerFunctionName", { value: server.functionName });
  new CfnOutput(stack, "ServerFunctionUrl", { value: url.url });
  return { bucket, distribution, server, url, siteOrigins };
}
