import { CloudWatchClient, SetAlarmStateCommand } from "@aws-sdk/client-cloudwatch";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { check, waitForMessage, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const cw = new CloudWatchClient({});
  const sqs = new SQSClient({});
  const isAlarm = (b: string) => b.includes(o.AlarmName) && b.includes("ALARM");
  // Our manual SetAlarmState calls carry a "byCheck" reason, so evaluation-driven ones are told apart.
  const isEvaluatedAlarm = (b: string) => isAlarm(b) && !b.includes("byCheck");
  return [
    await check("CloudWatch", "DLQ depth alarm fires on its own → SNS (waits up to 180s; AWS also takes 1-3 min)", async () => {
      await sqs.send(new SendMessageCommand({ QueueUrl: o.DlqUrl, MessageBody: "poison" }));
      // The alarm may already be in ALARM (metric history from earlier runs) and its notification
      // may have been drained by an earlier check. Force OK, so the next evaluation must flip it.
      await cw.send(new SetAlarmStateCommand({ AlarmName: o.AlarmName, StateValue: "OK", StateReason: "byCheck arm" }));
      await waitForMessage(o.SnsQueueUrl, isEvaluatedAlarm, 180000);
      return "metric evaluation moved OK → ALARM and notified SNS";
    }),
    await check("CloudWatch", "SetAlarmState ALARM → SNS alarm action", async () => {
      await cw.send(new SetAlarmStateCommand({ AlarmName: o.AlarmName, StateValue: "OK", StateReason: "byCheck reset" }));
      await cw.send(new SetAlarmStateCommand({ AlarmName: o.AlarmName, StateValue: "ALARM", StateReason: "byCheck manual" }));
      await waitForMessage(o.SnsQueueUrl, isAlarm);
      return "alarm action published to SNS";
    }),
  ];
}
