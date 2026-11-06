import { Logger } from "@aws-lambda-powertools/logger";

/**
 * Structured JSON logs (AWS Lambda Powertools): one JSON object per line with `service`, `level`,
 * `message`, timestamp, cold start and any keys you add. CloudWatch Logs Insights can then
 * filter/aggregate by field, e.g. `filter postId = "..."` to follow one photo through the pipeline.
 */
export function makeLogger(service: string) {
  return new Logger({ serviceName: service, logLevel: (process.env.LOG_LEVEL as "INFO") ?? "INFO" });
}
