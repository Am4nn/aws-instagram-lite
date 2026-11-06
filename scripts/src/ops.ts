/**
 * Ops CLI (npm run ops -- <command>)
 *   status            DLQ depths + alarm states
 *   chaos             break it on purpose: poison message → 3 failed tries → DLQ → alarm → ops inbox
 *   redrive <queue>   move messages from <queue>-dlq back to <queue> (after you fixed the bug)
 *   purge <queue>     drop everything in <queue>-dlq
 *   inbox             alarm notifications received by the ops topic (local only)
 *   logs <function>   recent JSON log lines of a Lambda (e.g. logs fanout)
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SQSClient, GetQueueUrlCommand, GetQueueAttributesCommand, SendMessageCommand,
  ReceiveMessageCommand, DeleteMessageCommand, PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { assertFlociUp, useLocalEnv } from "./env.js";

const PREFIX = "ig-local";
export const WORKER_QUEUES = ["uploads", "fanout", "notify"] as const;
// useQueueUrlAsEndpoint: false → keep the configured endpoint (Floci reports 127.0.0.1 in queue URLs)
const sqs = () => new SQSClient({ useQueueUrlAsEndpoint: false });

export async function queueUrl(name: string) {
  return (await sqs().send(new GetQueueUrlCommand({ QueueName: `${PREFIX}-${name}` }))).QueueUrl!;
}

export async function depth(name: string): Promise<number> {
  const r = await sqs().send(new GetQueueAttributesCommand({
    QueueUrl: await queueUrl(name), AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
  }));
  return Number(r.Attributes?.ApproximateNumberOfMessages ?? 0) + Number(r.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
}

export async function alarms() {
  const r = await new CloudWatchClient({}).send(new DescribeAlarmsCommand({ AlarmNamePrefix: PREFIX }));
  return (r.MetricAlarms ?? []).map((a) => ({ name: a.AlarmName!, state: a.StateValue!, reason: a.StateReason ?? "" }));
}

async function status() {
  console.log("Dead-letter queues (should be 0):");
  for (const q of WORKER_QUEUES) console.log(`  ${q.padEnd(8)} ${await depth(`${q}-dlq`)}`);
  console.log("\nAlarms:");
  for (const a of await alarms()) console.log(`  ${a.state.padEnd(17)} ${a.name}`);
}

/** Poison pill: the notify worker can't parse it, fails it 3 times, SQS moves it to the DLQ. */
export async function chaos() {
  await sqs().send(new SendMessageCommand({ QueueUrl: await queueUrl("notify"), MessageBody: "{this is not json" }));
  console.log("Sent a poison message to ig-local-notify. Watch: npm run ops -- status (takes ~3 min: 3 tries × 60 s visibility).");
}

export async function redrive(name: string): Promise<number> {
  const from = await queueUrl(`${name}-dlq`);
  const to = await queueUrl(name);
  let moved = 0;
  for (;;) {
    const { Messages = [] } = await sqs().send(new ReceiveMessageCommand({ QueueUrl: from, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
    if (!Messages.length) break;
    for (const m of Messages) {
      await sqs().send(new SendMessageCommand({ QueueUrl: to, MessageBody: m.Body! }));
      await sqs().send(new DeleteMessageCommand({ QueueUrl: from, ReceiptHandle: m.ReceiptHandle! }));
      moved++;
    }
  }
  return moved; // (AWS also has a built-in "Start DLQ redrive" button / StartMessageMoveTask API)
}

export async function purge(name: string) {
  await sqs().send(new PurgeQueueCommand({ QueueUrl: await queueUrl(`${name}-dlq`) }));
}

export async function inbox(waitSeconds = 1): Promise<string[]> {
  const url = await queueUrl("ops-inbox");
  const out: string[] = [];
  for (;;) {
    const { Messages = [] } = await sqs().send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: waitSeconds }));
    if (!Messages.length) break;
    for (const m of Messages) {
      out.push(m.Body!);
      await sqs().send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle! }));
    }
  }
  return out;
}

/** Locally Floci prints each Lambda's stdout in its container; on AWS use CloudWatch Logs Insights. */
function logs(fn: string) {
  const names = execFileSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split("\n").filter((n) => n.startsWith(`floci-aws-${PREFIX}-${fn}-`));
  if (!names.length) return console.log(`No container for ${fn} yet (it hasn't run).`);
  const text = execFileSync("docker", ["logs", "--tail", "200", names[0]], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const line of text.split("\n")) {
    const i = line.indexOf("{\"");
    if (i >= 0) console.log(line.slice(i));
  }
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const [cmd = "status", arg] = process.argv.slice(2);
  if (cmd === "status") await status();
  else if (cmd === "chaos") await chaos();
  else if (cmd === "redrive") console.log(`Moved ${await redrive(arg)} message(s) back to ${PREFIX}-${arg}.`);
  else if (cmd === "purge") { await purge(arg); console.log(`Purged ${PREFIX}-${arg}-dlq.`); }
  else if (cmd === "inbox") for (const m of await inbox()) console.log(m);
  else if (cmd === "logs") logs(arg);
  else console.log("commands: status | chaos | redrive <queue> | purge <queue> | inbox | logs <function>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
