import { createHash } from "node:crypto";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export type NotifType = "PostLiked" | "PostCommented" | "UserFollowed";
export type NewNotif = {
  recipientId: string;
  type: NotifType;
  actorId: string;
  actorUsername: string;
  postId?: string;
  text?: string;
  /** When the source event happened (ISO). */
  at: string;
  /** Identifies the source event; same event → same item (idempotent). */
  sourceKey: string;
};
export type Notif = Omit<NewNotif, "recipientId" | "sourceKey"> & { id: string };

const TTL_SECONDS = 90 * 24 * 3600;
const stateKey = (userId: string) => ({ pk: `USER#${userId}`, sk: "NOTIFSTATE" });

export type NotifsRepo = ReturnType<typeof makeNotifsRepo>;

export function makeNotifsRepo(doc: DynamoDBDocumentClient, table: string) {
  async function put(n: NewNotif) {
    const id = createHash("sha1").update(n.sourceKey).digest("hex").slice(0, 16);
    await doc.send(new PutCommand({ TableName: table, Item: {
      pk: `NOTIF#${n.recipientId}`, sk: `${n.at}#${id}`, type: "notif", id,
      notifType: n.type, actorId: n.actorId, actorUsername: n.actorUsername,
      postId: n.postId, text: n.text, at: n.at,
      ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    } }));
  }

  async function list(userId: string, limit = 30): Promise<Notif[]> {
    const r = await doc.send(new QueryCommand({
      TableName: table, KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `NOTIF#${userId}` }, ScanIndexForward: false, Limit: limit,
    }));
    return (r.Items ?? []).map((i) => ({
      id: i.id, type: i.notifType, actorId: i.actorId, actorUsername: i.actorUsername,
      at: i.at, ...(i.postId ? { postId: i.postId } : {}), ...(i.text ? { text: i.text } : {}),
    }));
  }

  /**
   * "Unread" = newer than the lastReadAt marker. Mark-all-read is one tiny write instead of
   * flipping a flag on every notification. Capped at 99 (the badge shows "99+").
   */
  async function unreadCount(userId: string): Promise<number> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: stateKey(userId) }));
    const since = (Item?.lastReadAt as string | undefined) ?? "";
    const r = await doc.send(new QueryCommand({
      TableName: table, KeyConditionExpression: "pk = :pk AND sk > :since",
      ExpressionAttributeValues: { ":pk": `NOTIF#${userId}`, ":since": `${since}#~` },
      Select: "COUNT", Limit: 99,
    }));
    return r.Count ?? 0;
  }

  async function markAllRead(userId: string, at = new Date().toISOString()) {
    await doc.send(new PutCommand({ TableName: table, Item: { ...stateKey(userId), lastReadAt: at } }));
  }

  return { put, list, unreadCount, markAllRead };
}
