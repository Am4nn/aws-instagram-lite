import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { RemovalPolicy } from "aws-cdk-lib";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { CoreStack } from "./core-stack.js";

/**
 * Follow + feed (step 4):
 *   follow/unfollow (social Lambda) → FOLLOWER# item → stream → UserFollowed → EventBridge
 *   pipeline Publish --PostPublished--> EventBridge
 *   EventBridge rule --> SQS fanout (+DLQ) --> fanout Lambda --> FEED#<follower> items
 *   GET /feed (feed Lambda) = pushed items + pulled celeb posts, signed cursor (Secrets Manager key)
 */
export function addSocial(stack: CoreStack, opts: { bus: events.EventBus }) {
  const { prefix, celebThreshold } = stack.stageConfig;
  const threshold = String(celebThreshold);

  const cursorKey = new secrets.Secret(stack, "CursorKey", {
    secretName: `${prefix}-cursor-key`,
    generateSecretString: { passwordLength: 48, excludePunctuation: true },
    removalPolicy: RemovalPolicy.DESTROY,
  });

  // ---------- follow / unfollow ----------
  // UserFollowed is emitted by the table stream (step 5 CDC), so this Lambda needs no bus access.
  const social = stack.addFunction("social", "social/handler.ts", { env: { CELEB_THRESHOLD: threshold } });
  stack.route("POST", "/users/{userId}/follow", social);
  stack.route("DELETE", "/users/{userId}/follow", social);

  // ---------- fan-out (choreography: reacts to events, nobody calls it) ----------
  const dlq = new sqs.Queue(stack, "FanoutDlq", { queueName: `${prefix}-fanout-dlq`, retentionPeriod: Duration.days(14) });
  const queue = new sqs.Queue(stack, "FanoutQueue", {
    queueName: `${prefix}-fanout`,
    visibilityTimeout: Duration.seconds(360), // 6× the Lambda timeout, as AWS recommends
    deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
  });
  new events.Rule(stack, "FanoutRule", {
    ruleName: `${prefix}-fanout`,
    eventBus: opts.bus,
    eventPattern: { detailType: ["PostPublished", "UserFollowed"] },
    targets: [new targets.SqsQueue(queue)],
  });
  const fanout = stack.addFunction("fanout", "feed/fanout.ts", { env: { CELEB_THRESHOLD: threshold }, timeout: 60 });
  // batchSize 1: one post's fan-out (up to threshold-1 followers ≈ 400 BatchWrites on AWS) per invocation,
  // so a slow one can't time out the others in its batch.
  fanout.addEventSource(new SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true }));

  // ---------- read the feed ----------
  const feed = stack.addFunction("feed", "feed/handler.ts", {
    env: { CELEB_THRESHOLD: threshold, CURSOR_SECRET_ARN: cursorKey.secretArn },
  });
  cursorKey.grantRead(feed);
  stack.route("GET", "/feed", feed);

  return { cursorKey, fanoutQueue: queue, fanoutDlq: dlq };
}
