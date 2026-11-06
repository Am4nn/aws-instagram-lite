import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { CoreStack } from "./core-stack.js";

/**
 * Web hosting (step 7): Next.js static export in a PRIVATE bucket, served by CloudFront.
 * Origin Access Control (OAC) = only this distribution may read the bucket; nobody hits S3 directly.
 * Files are uploaded by `npm run deploy:web` (aws s3 sync), not by CDK's BucketDeployment
 * (which would need a Lambda-backed custom resource).
 */
export function addWeb(stack: CoreStack) {
  const { prefix, isLocal } = stack.stageConfig;
  const bucket = new s3.Bucket(stack, "Web", {
    bucketName: `${prefix}-web-${stack.account}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: !isLocal,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  const distribution = new cloudfront.Distribution(stack, "Cdn", {
    comment: `${prefix} web`,
    defaultRootObject: "index.html",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // honours each file's Cache-Control
      compress: true,
    },
    errorResponses: [
      { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: Duration.minutes(1) },
      // S3 answers 403 (not 404) for missing keys when the caller can't list the bucket
      { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: Duration.minutes(1) },
    ],
    priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // cheapest edge set (NA + EU)
  });

  new CfnOutput(stack, "WebBucket", { value: bucket.bucketName });
  new CfnOutput(stack, "DistributionId", { value: distribution.distributionId });
  new CfnOutput(stack, "DistributionDomain", { value: distribution.distributionDomainName });
  return { bucket, distribution };
}
