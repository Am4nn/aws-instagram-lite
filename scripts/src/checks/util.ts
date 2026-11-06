import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import type { CheckResult } from "../report.js";

export type Outputs = Record<string, string>;

/** Runs one check; any throw becomes a ❌ row instead of stopping the spike. */
export async function check(
  service: string, feature: string, fn: () => Promise<string | void>,
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const notes = (await fn()) ?? "";
    return { service, feature, ok: true, notes, ms: Date.now() - t0 };
  } catch (e) {
    return { service, feature, ok: false, notes: String((e as Error).message ?? e), ms: Date.now() - t0 };
  }
}

/** Polls a queue until a message body matches, deleting what it reads. */
export async function waitForMessage(
  queueUrl: string, match: (body: string) => boolean, timeoutMs = 20000,
): Promise<string> {
  const client = new SQSClient({});
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { Messages = [] } = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2,
    }));
    for (const m of Messages) {
      await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
      if (m.Body && match(m.Body)) return m.Body;
    }
  }
  throw new Error(`no matching message on ${queueUrl.split("/").pop()} within ${timeoutMs / 1000}s`);
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
