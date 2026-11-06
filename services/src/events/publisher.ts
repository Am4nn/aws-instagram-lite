import type { DynamoDBStreamEvent, DynamoDBBatchResponse } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { toDomainEvent, type DomainEvent } from "./map.js";

type Put = (entries: DomainEvent[]) => Promise<{ ok: boolean }[]>;

/**
 * DynamoDB Stream (new items) → EventBridge. On failure we report the first failed record's
 * sequence number; Lambda retries the batch from there, so nothing is skipped (and order is kept).
 */
export function makePublisher(put: Put) {
  return async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const mapped: { seq: string; event: DomainEvent }[] = [];
    for (const r of event.Records) {
      if (r.eventName !== "INSERT" || !r.dynamodb?.NewImage) continue;
      const e = toDomainEvent(unmarshall(r.dynamodb.NewImage as Record<string, AttributeValue>));
      if (e) mapped.push({ seq: r.dynamodb.SequenceNumber!, event: e });
    }
    for (let i = 0; i < mapped.length; i += 10) { // PutEvents takes up to 10 entries
      const chunk = mapped.slice(i, i + 10);
      const results = await put(chunk.map((m) => m.event)).catch(() => chunk.map(() => ({ ok: false })));
      const failed = results.findIndex((r) => !r.ok);
      if (failed >= 0) return { batchItemFailures: [{ itemIdentifier: chunk[failed].seq }] };
    }
    return { batchItemFailures: [] };
  };
}

const eb = new EventBridgeClient({});
export const handler = makePublisher(async (entries) => {
  const r = await eb.send(new PutEventsCommand({ Entries: entries.map((e) => ({
    EventBusName: process.env.EVENT_BUS, Source: e.source, DetailType: e.detailType, Detail: JSON.stringify(e.detail),
  })) }));
  return (r.Entries ?? []).map((x) => ({ ok: !x.ErrorCode }));
});
