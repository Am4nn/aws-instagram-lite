import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { parseUploadKey } from "../posts/keys.js";
import { makeLogger } from "../lib/log.js";

const log = makeLogger("pipeline-starter");

export type PipelineInput = { bucket: string; key: string; userId: string; postId: string };
type Start = (name: string, input: PipelineInput) => Promise<void>;

/** S3 event notifications URL-encode keys (and use + for spaces). */
const decodeKey = (k: string) => decodeURIComponent(k.replace(/\+/g, " "));

/**
 * SQS → Step Functions. One execution per upload, named by postId: Step Functions refuses a
 * second execution with the same name, so a redelivered message can't process a photo twice.
 */
export function makeStarter(start: Start) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        for (const r of body.Records ?? []) {
          const key = decodeKey(r.s3.object.key);
          const ids = parseUploadKey(key);
          if (!ids) continue; // not an upload (or s3:TestEvent has no Records)
          try {
            await start(ids.postId, { bucket: r.s3.bucket.name, key, ...ids });
            log.info("pipeline started", { postId: ids.postId, userId: ids.userId, messageId: record.messageId });
          } catch (e) {
            if ((e as Error).name !== "ExecutionAlreadyExists") throw e;
          }
        }
      } catch (e) {
        log.error("starter failed", { messageId: record.messageId, error: e as Error });
        batchItemFailures.push({ itemIdentifier: record.messageId }); // only this message is retried
      }
    }
    return { batchItemFailures };
  };
}

const sfn = new SFNClient({});
export const handler = makeStarter(async (name, input) => {
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN, name, input: JSON.stringify(input),
  }));
});
