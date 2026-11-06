import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { check, waitForMessage, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const sns = new SNSClient({});
  const marker = `sns-${Date.now()}`;
  return [
    await check("SNS", "Topic → SQS subscription (raw delivery)", async () => {
      await sns.send(new PublishCommand({ TopicArn: o.TopicArn, Message: marker }));
      const body = await waitForMessage(o.SnsQueueUrl, (b) => b.includes(marker));
      return body === marker ? "raw body delivered" : "delivered, but wrapped (raw delivery ignored)";
    }),
  ];
}
