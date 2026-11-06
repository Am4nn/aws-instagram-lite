import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { DynamoEventSource, SqsEventSource, SqsDlq } from "aws-cdk-lib/aws-lambda-event-sources";
import type { CoreStack } from "./core-stack.js";

/**
 * Likes, comments, notifications (step 5):
 *   engage Lambda writes LIKE#/COMMENT# items ──► DynamoDB stream (INSERT) ──► events Lambda
 *   (also FOLLOWER# from step 4)                    = change data capture       │
 *                                                           PostLiked / PostCommented / UserFollowed
 *                                                                              ▼
 *   EventBridge rule ──► SQS notify (+DLQ) ──► notify Lambda ──► NOTIF# items + SNS topic
 */
export function addEngage(stack: CoreStack, opts: { bus: events.EventBus }) {
  const { prefix } = stack.stageConfig;

  // ---------- likes + comments API ----------
  const engage = stack.addFunction("engage", "engage/handler.ts");
  stack.route("POST", "/posts/{id}/like", engage);
  stack.route("DELETE", "/posts/{id}/like", engage);
  stack.route("GET", "/posts/{id}/comments", engage);
  stack.route("POST", "/posts/{id}/comments", engage);

  // ---------- CDC: table stream → domain events ----------
  const publisher = stack.addFunction("events", "events/publisher.ts", {
    env: { EVENT_BUS: opts.bus.eventBusName }, tableAccess: false,
  });
  opts.bus.grantPutEventsTo(publisher);
  // After retries run out, the failed records' positions go to this DLQ (alarmed in ops), never silently dropped.
  const cdcDlq = new sqs.Queue(stack, "CdcDlq", { queueName: `${prefix}-cdc-dlq`, retentionPeriod: Duration.days(14) });
  publisher.addEventSource(new DynamoEventSource(stack.table, {
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 50,
    reportBatchItemFailures: true,
    retryAttempts: 10,
    maxRecordAge: Duration.hours(1),
    onFailure: new SqsDlq(cdcDlq),
    filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual("INSERT") })],
  }));

  // ---------- notifications ----------
  const topic = new sns.Topic(stack, "NotifyTopic", { topicName: `${prefix}-notifications` });
  const dlq = new sqs.Queue(stack, "NotifyDlq", { queueName: `${prefix}-notify-dlq`, retentionPeriod: Duration.days(14) });
  const queue = new sqs.Queue(stack, "NotifyQueue", {
    queueName: `${prefix}-notify`,
    visibilityTimeout: Duration.seconds(60),
    deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
  });
  new events.Rule(stack, "NotifyRule", {
    ruleName: `${prefix}-notify`,
    eventBus: opts.bus,
    eventPattern: { detailType: ["PostLiked", "PostCommented", "UserFollowed"] },
    targets: [new targets.SqsQueue(queue)],
  });
  const notify = stack.addFunction("notify", "notify/worker.ts", { env: { NOTIFY_TOPIC_ARN: topic.topicArn } });
  topic.grantPublish(notify);
  notify.addEventSource(new SqsEventSource(queue, { batchSize: 10, reportBatchItemFailures: true }));

  const notifications = stack.addFunction("notifications", "notify/handler.ts");
  stack.route("GET", "/notifications", notifications);
  stack.route("POST", "/notifications/read", notifications);

  return { topic, notifyQueue: queue, notifyDlq: dlq, cdcDlq };
}
