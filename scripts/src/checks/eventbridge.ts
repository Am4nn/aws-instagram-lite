import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { check, assert, waitForMessage, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const eb = new EventBridgeClient({});
  const marker = `evt-${Date.now()}`;
  return [
    await check("EventBridge", "Custom bus rule (source match) → SQS target", async () => {
      const r = await eb.send(new PutEventsCommand({ Entries: [{
        EventBusName: o.BusName, Source: "ig.spike", DetailType: "Spike", Detail: JSON.stringify({ marker }),
      }] }));
      assert(!r.FailedEntryCount, `FailedEntryCount ${r.FailedEntryCount}`);
      await waitForMessage(o.EventsQueueUrl, (b) => b.includes(marker));
      return "event delivered";
    }),
  ];
}
