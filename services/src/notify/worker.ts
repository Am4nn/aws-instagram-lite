import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makeNotifsRepo, type NewNotif, type NotifType } from "./repo.js";
import { makeLogger } from "../lib/log.js";

const log = makeLogger("notify");

type Deps = {
  getUsername: (userId: string) => Promise<string>;
  put: (n: NewNotif) => Promise<void>;
  /** Fan-out to other channels (email, push…). SNS lets any number of them subscribe. */
  publish: (recipientId: string, text: string, type: NotifType) => Promise<void>;
};

type Routed = { recipientId: string; actorId: string; postId?: string; text?: string; sourceKey: string };

/**
 * sourceKey identifies the *row* that caused the event (like = post+actor+time liked, comment = its id),
 * never the EventBridge publish time: a stream retry re-publishes with a new time but the same row.
 */
function route(type: string, d: Record<string, string>): Routed | null {
  switch (type) {
    case "PostLiked":
      return { recipientId: d.authorId, actorId: d.actorId, postId: d.postId, sourceKey: `like:${d.postId}:${d.actorId}:${d.createdAt}` };
    case "PostCommented":
      return { recipientId: d.authorId, actorId: d.actorId, postId: d.postId, text: d.text, sourceKey: `comment:${d.commentId}` };
    case "UserFollowed":
      return { recipientId: d.followeeId, actorId: d.followerId, sourceKey: `follow:${d.followerId}:${d.followeeId}:${d.createdAt}` };
    default:
      return null;
  }
}

const phrase: Record<NotifType, string> = {
  PostLiked: "liked your post",
  PostCommented: "commented on your post",
  UserFollowed: "started following you",
};

export function makeNotify(d: Deps) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        const e = JSON.parse(record.body);
        const type = e["detail-type"] as NotifType;
        const r = route(type, e.detail ?? {});
        if (!r || r.recipientId === r.actorId) continue; // unknown event, or your own action
        const actorUsername = await d.getUsername(r.actorId);
        await d.put({ ...r, type, actorUsername, at: e.detail?.createdAt ?? e.time });
        await d.publish(r.recipientId, `${actorUsername} ${phrase[type]}`, type);
        log.info("notified", { type, recipientId: r.recipientId, actorId: r.actorId, postId: r.postId });
      } catch (err) {
        log.error("notify failed", { messageId: record.messageId, error: err as Error });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

let real: ReturnType<typeof makeNotify> | undefined;
export const handler = (event: SQSEvent) => {
  real ??= (() => {
    const users = makeUsersRepo(docClient(), tableName());
    const repo = makeNotifsRepo(docClient(), tableName());
    const sns = new SNSClient({});
    return makeNotify({
      getUsername: async (id) => (await users.getProfile(id))?.username ?? "someone",
      put: (n) => repo.put(n),
      publish: async (recipientId, text, type) => {
        await sns.send(new PublishCommand({
          TopicArn: process.env.NOTIFY_TOPIC_ARN, Message: text,
          // Subscribers filter on these (e.g. an email sender only for UserFollowed)
          MessageAttributes: {
            recipientId: { DataType: "String", StringValue: recipientId },
            type: { DataType: "String", StringValue: type },
          },
        }));
      },
    });
  })();
  return real(event);
};
