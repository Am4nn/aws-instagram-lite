import { CfnOutput, Duration } from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import type { CoreStack } from "./core-stack.js";

/**
 * Ops (step 6): alert on *symptoms users would feel*: messages giving up (DLQ not empty) and
 * photos failing to process. Alarms → ops SNS topic → (on AWS) email/Slack/PagerDuty.
 */
export function addOps(stack: CoreStack, opts: { dlqs: Record<string, sqs.Queue>; pipeline: sfn.StateMachine }) {
  const { prefix, isLocal } = stack.stageConfig;
  const topic = new sns.Topic(stack, "OpsTopic", { topicName: `${prefix}-ops` });
  const action = new cwActions.SnsAction(topic);

  for (const [name, dlq] of Object.entries(opts.dlqs)) {
    const alarm = new cloudwatch.Alarm(stack, `${name}DlqAlarm`, {
      alarmName: `${prefix}-${name}-dlq-not-empty`,
      alarmDescription: `Messages failed 3 times and landed in ${dlq.queueName}. Runbook: docs/learn/06-ops.md`,
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: "Maximum" }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(action);
    alarm.addOkAction(action);
  }

  const failed = new cloudwatch.Alarm(stack, "PipelineFailedAlarm", {
    alarmName: `${prefix}-pipeline-failed`,
    alarmDescription: "A photo pipeline run failed (bad uploads end in MarkFailed and still count). Check recent executions.",
    metric: opts.pipeline.metricFailed({ period: Duration.minutes(5), statistic: "Sum" }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  failed.addAlarmAction(action);

  // Locally there's no email/Slack: alarms land in a queue the ops script reads.
  if (isLocal) {
    const inbox = new sqs.Queue(stack, "OpsInbox", { queueName: `${prefix}-ops-inbox` });
    topic.addSubscription(new subs.SqsSubscription(inbox, { rawMessageDelivery: true }));
    new CfnOutput(stack, "OpsInboxUrl", { value: inbox.queueUrl });
  }
  new CfnOutput(stack, "OpsTopicArn", { value: topic.topicArn });
  return { topic };
}
