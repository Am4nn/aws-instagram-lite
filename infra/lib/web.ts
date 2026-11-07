import { Annotations, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { CoreStack } from "./core-stack.js";

/**
 * Web hosting (step 7): Next.js static export in a PRIVATE bucket, served by CloudFront.
 * Origin Access Control (OAC) = only this distribution may read the bucket; nobody hits S3 directly.
 * Files are uploaded by `npm run deploy:web` / `deploy:aws` (SDK PutObject, stale keys deleted), not
 * by CDK's BucketDeployment (which would need a Lambda-backed custom resource).
 * `cdk destroy` can't delete a non-empty bucket: `npm run destroy:aws` empties the ig-aws buckets first.
 */
export function addWeb(stack: CoreStack) {
  const { prefix, isLocal } = stack.stageConfig;
  const bucket = new s3.Bucket(stack, "Web", {
    bucketName: `${prefix}-web-${stack.account}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: !isLocal,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  const notFound = { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: Duration.minutes(1) };
  const distribution = new cloudfront.Distribution(stack, "Cdn", {
    comment: `${prefix} web`,
    defaultRootObject: "index.html",
    defaultBehavior: {
      // aws: OAC may also LIST the bucket, so S3 answers a missing key with 404 (not 403). A 403 then
      // means a real access problem and is not hidden behind the 404 page.
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, isLocal ? {} : {
        originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // honours each file's Cache-Control
      compress: true,
      // aws: AWS-managed policy (HSTS, nosniff, X-Frame-Options, Referrer-Policy); creates no resource
      ...(isLocal ? {} : { responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS }),
    },
    errorResponses: isLocal
      // Floci: S3 answers 403 (not 404) for missing keys when the caller can't list the bucket
      ? [notFound, { ...notFound, httpStatus: 403 }]
      : [notFound],
    // local: cheapest edge set (NA + EU). aws: PRICE_CLASS_200 adds Asia incl. India, where the users are (the stack itself is in Sydney).
    priceClass: isLocal ? cloudfront.PriceClass.PRICE_CLASS_100 : cloudfront.PriceClass.PRICE_CLASS_200,
  });

  // CDK warns that LIST lets visitors probe for keys without a root object; defaultRootObject is set above.
  Annotations.of(distribution).acknowledgeWarning("@aws-cdk/aws-cloudfront-origins:listBucketSecurityRisk");

  new CfnOutput(stack, "WebBucket", { value: bucket.bucketName });
  new CfnOutput(stack, "DistributionId", { value: distribution.distributionId });
  new CfnOutput(stack, "DistributionDomain", { value: distribution.distributionDomainName });
  return { bucket, distribution };
}
