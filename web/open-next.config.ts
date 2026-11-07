import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

/**
 * OpenNext (`npx open-next build`) turns the Next.js build into a Lambda bundle:
 *   .open-next/server-functions/default  → the server Lambda (infra/lib/web.ts)
 *   .open-next/assets                    → S3 (_next/static/*, served by CloudFront)
 * Plain request/response Lambda (no streaming), API Gateway v2 event shape (= Function URL events).
 * Every page is personal, so nothing is cached between users: no ISR cache, tag cache or revalidation queue.
 */
const config = {
  default: {
    override: {
      wrapper: "aws-lambda",
      converter: "aws-apigw-v2",
      incrementalCache: "dummy",
      tagCache: "dummy",
      queue: "dummy",
    },
  },
  dangerous: { disableIncrementalCache: true, disableTagCache: true },
} satisfies OpenNextConfig;

export default config;
