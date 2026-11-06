import {
  DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { profileKey } from "../users/repo.js";

// A follow is two items (one per direction) so both "who do I follow" and
// "who follows me" are single-partition queries.
export const followsKey = (me: string, other: string) => ({ pk: `USER#${me}`, sk: `FOLLOWS#${other}` });
export const followerKey = (other: string, me: string) => ({ pk: `USER#${other}`, sk: `FOLLOWER#${me}` });

const cancelled = (e: unknown) => (e as Error).name === "TransactionCanceledException";

export type FollowsRepo = ReturnType<typeof makeFollowsRepo>;

export function makeFollowsRepo(doc: DynamoDBDocumentClient, table: string) {
  const counter = (userId: string, field: string, delta: number) => ({
    Update: {
      TableName: table, Key: profileKey(userId), ConditionExpression: "attribute_exists(pk)",
      UpdateExpression: `ADD ${field} :d`, ExpressionAttributeValues: { ":d": delta },
    },
  });

  /** true = new follow. Both edges + both counters in one transaction, so counts can't drift. */
  async function follow(me: string, other: string): Promise<boolean> {
    const now = new Date().toISOString();
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: table, Item: { ...followsKey(me, other), userId: other, createdAt: now },
          ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: table, Item: { ...followerKey(other, me), userId: me, createdAt: now } } },
        counter(me, "followingCount", 1),
        counter(other, "followerCount", 1),
      ] }));
      return true;
    } catch (e) {
      if (cancelled(e)) return false; // already following (or a profile is missing)
      throw e;
    }
  }

  async function unfollow(me: string, other: string): Promise<boolean> {
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Delete: { TableName: table, Key: followsKey(me, other), ConditionExpression: "attribute_exists(pk)" } },
        { Delete: { TableName: table, Key: followerKey(other, me) } },
        counter(me, "followingCount", -1),
        counter(other, "followerCount", -1),
      ] }));
      return true;
    } catch (e) {
      if (cancelled(e)) return false;
      throw e;
    }
  }

  async function isFollowing(me: string, other: string): Promise<boolean> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: followsKey(me, other) }));
    return Boolean(Item);
  }

  async function* edges(userId: string, prefix: string, pageSize: number): AsyncGenerator<string[]> {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(new QueryCommand({
        TableName: table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":p": prefix },
        Limit: pageSize, ExclusiveStartKey,
      }));
      const ids = (r.Items ?? []).map((i) => i.userId as string);
      if (ids.length) yield ids;
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }

  async function listFollowing(me: string, max = 1000): Promise<string[]> {
    const out: string[] = [];
    for await (const page of edges(me, "FOLLOWS#", 200)) {
      out.push(...page);
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  }

  /** Followers in pages: fan-out walks these without loading millions into memory. */
  const listFollowers = (userId: string, pageSize = 500) => edges(userId, "FOLLOWER#", pageSize);

  return { follow, unfollow, isFollowing, listFollowing, listFollowers };
}
