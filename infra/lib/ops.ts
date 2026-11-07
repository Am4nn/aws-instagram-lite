import { CfnOutput, Duration } from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import type * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import type { CoreStack } from "./core-stack.js";

/**
 * Ops (step 6): alert on *symptoms users would feel*: messages giving up (DLQ not empty) and
 * photos failing to process. Alarms → ops SNS topic → (on AWS) email/Slack/PagerDuty.
 */
export function addOps(stack: CoreStack, opts: {
  dlqs: Record<string, sqs.Queue>; queues: Record<string, sqs.Queue>; pipeline: sfn.StateMachine; api: apigwv2.HttpApi;
}) {
  const { prefix, isLocal } = stack.stageConfig;
  const topic = new sns.Topic(stack, "OpsTopic", { topicName: `${prefix}-ops` });
  const action = new cwActions.SnsAction(topic);
  const alarms: cloudwatch.Alarm[] = [];

  for (const [name, dlq] of Object.entries(opts.dlqs)) {
    const alarm = new cloudwatch.Alarm(stack, `${name}DlqAlarm`, {
      alarmName: `${prefix}-${name}-dlq-not-empty`,
      alarmDescription: `Messages gave up after their retries and landed in ${dlq.queueName}. Runbook: docs/learn/06-ops.md`,
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: "Maximum" }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(action);
    alarm.addOkAction(action);
    alarms.push(alarm);
  }

  const failed = new cloudwatch.Alarm(stack, "PipelineFailedAlarm", {
    alarmName: `${prefix}-pipeline-failed`,
    alarmDescription: "A photo pipeline run failed for a system reason (rejected uploads end in Succeed and don't count). Check recent executions.",
    metric: opts.pipeline.metricFailed({ period: Duration.minutes(5), statistic: "Sum" }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  failed.addAlarmAction(action);
  failed.addOkAction(action);

  // Users seeing errors: 5 or more server errors (5xx) from the API within 5 minutes.
  const api5xx = new cloudwatch.Alarm(stack, "Api5xxAlarm", {
    alarmName: `${prefix}-api-5xx`,
    alarmDescription: "The API returned 5+ server errors in 5 minutes. Check the Lambda logs for the failing route.",
    metric: opts.api.metricServerError({ period: Duration.minutes(5), statistic: "Sum" }),
    threshold: 5,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  api5xx.addAlarmAction(action);
  api5xx.addOkAction(action);
  alarms.push(failed, api5xx);

  // One page to answer "is anything broken?" (aws only; first 3 dashboards are free tier).
  if (!isLocal) addDashboard(stack, { ...opts, alarms });

  // Locally there's no email/Slack: alarms land in a queue the ops script reads.
  if (isLocal) {
    const inbox = new sqs.Queue(stack, "OpsInbox", { queueName: `${prefix}-ops-inbox` });
    topic.addSubscription(new subs.SqsSubscription(inbox, { rawMessageDelivery: true }));
    new CfnOutput(stack, "OpsInboxUrl", { value: inbox.queueUrl });
  }
  // On AWS: optional email (-c alertEmail=... or IG_ALERT_EMAIL). AWS mails a link you must click once.
  if (!isLocal && stack.stageConfig.alertEmail) {
    topic.addSubscription(new subs.EmailSubscription(stack.stageConfig.alertEmail));
  }
  new CfnOutput(stack, "OpsTopicArn", { value: topic.topicArn });
  return { topic };
}

/** CloudWatch dashboard `<prefix>-ops`: alarms on top, then API, Lambdas, queues + pipeline. */
function addDashboard(stack: CoreStack, opts: {
  dlqs: Record<string, sqs.Queue>; queues: Record<string, sqs.Queue>; pipeline: sfn.StateMachine;
  api: apigwv2.HttpApi; alarms: cloudwatch.Alarm[];
}) {
  const { prefix } = stack.stageConfig;
  const five = Duration.minutes(5);
  const fns = Object.entries(stack.functions);
  const graph = (title: string, left: cloudwatch.IMetric[], width: number) =>
    new cloudwatch.GraphWidget({ title, left, width, height: 6 });

  const dash = new cloudwatch.Dashboard(stack, "OpsDashboard", { dashboardName: `${prefix}-ops` });
  dash.addWidgets(new cloudwatch.AlarmStatusWidget({ title: "Alarms (red = something is broken)", alarms: opts.alarms, width: 24, height: 3 }));
  dash.addWidgets(
    graph("API requests", [opts.api.metricCount({ period: five, statistic: "Sum", label: "requests" })], 8),
    graph("API errors", [
      opts.api.metricClientError({ period: five, statistic: "Sum", label: "4xx (client)" }),
      opts.api.metricServerError({ period: five, statistic: "Sum", label: "5xx (our bug)" }),
    ], 8),
    graph("API latency p90 (ms)", [opts.api.metricLatency({ period: five, statistic: "p90", label: "p90" })], 8),
  );
  dash.addWidgets(
    graph("Lambda errors", fns.map(([name, fn]) => fn.metricErrors({ period: five, statistic: "Sum", label: name })), 12),
    graph("Lambda duration p90 (ms)", fns.map(([name, fn]) => fn.metricDuration({ period: five, statistic: "p90", label: name })), 12),
  );
  const depth = (qs: Record<string, sqs.Queue>) => Object.entries(qs).map(([name, q]) =>
    q.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: "Maximum", label: name }));
  dash.addWidgets(
    graph("Queue backlog (waiting tasks)", depth(opts.queues), 8),
    graph("DLQs (failed tasks, should be 0)", depth(opts.dlqs), 8),
    graph("Photo pipeline runs", [
      opts.pipeline.metricStarted({ period: five, statistic: "Sum", label: "started" }),
      opts.pipeline.metricSucceeded({ period: five, statistic: "Sum", label: "succeeded" }),
      opts.pipeline.metricFailed({ period: five, statistic: "Sum", label: "failed" }),
    ], 8),
  );
}
