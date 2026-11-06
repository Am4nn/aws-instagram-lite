import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { profileKey } from "../users/repo.js";
import { conditionalWrite } from "../lib/tx.js";
import { batchGetAll } from "../lib/batch.js";

// A follow is two items (one per direction) so both "who do I follow" and
// "who follows me" are single-partition queries.
export const followsKey = (me: string, other: string) => ({ pk: `USER#${me}`, sk: `FOLLOWS#${other}` });
export const followerKey = (other: string, me: string) => ({ pk: `USER#${other}`, sk: `FOLLOWER#${me}` });
/** Celeb registry: one small partition listing every celeb. Feeds read it (cached) to know whom to pull. */
export const celebKey = (userId: string) => ({ pk: "CELEBS", sk: `USER#${userId}` });


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
    return conditionalWrite(() =>
      doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: table, Item: { ...followsKey(me, other), userId: other, createdAt: now },
          ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: table, Item: { ...followerKey(other, me), userId: me, createdAt: now } } },
        counter(me, "followingCount", 1),
        counter(other, "followerCount", 1),
      ] })),
    // already following (or a profile is missing, which retrying won't fix)
    async () => (await isFollowing(me, other)) || !(await bothProfilesExist(me, other)));
  }

  async function unfollow(me: string, other: string): Promise<boolean> {
    return conditionalWrite(() =>
      doc.send(new TransactWriteCommand({ TransactItems: [
        { Delete: { TableName: table, Key: followsKey(me, other), ConditionExpression: "attribute_exists(pk)" } },
        { Delete: { TableName: table, Key: followerKey(other, me) } },
        counter(me, "followingCount", -1),
        counter(other, "followerCount", -1),
      ] })),
    async () => !(await isFollowing(me, other)));
  }

  async function bothProfilesExist(a: string, b: string) {
    const get = (id: string) => doc.send(new GetCommand({ TableName: table, Key: profileKey(id) })).then((r) => Boolean(r.Item));
    return (await get(a)) && (await get(b));
  }

  async function isFollowing(me: string, other: string): Promise<boolean> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: followsKey(me, other), ConsistentRead: true }));
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

  /**
   * Called after a follow. Once someone reaches the threshold they're registered as a celeb:
   * their posts stop being pushed and are pulled at read time instead. Sticky on purpose (no
   * removal on unfollow): otherwise posts made while celeb, never pushed, would vanish from feeds.
   */
  async function registerCelebIfNeeded(userId: string, threshold: number): Promise<boolean> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: profileKey(userId), ConsistentRead: true }));
    if (((Item?.followerCount as number) ?? 0) < threshold) return false;
    await doc.send(new PutCommand({ TableName: table, Item: { ...celebKey(userId), userId } }));
    return true;
  }

  async function isCeleb(userId: string): Promise<boolean> {
    return Boolean((await doc.send(new GetCommand({ TableName: table, Key: celebKey(userId) }))).Item);
  }

  async function listCelebs(): Promise<string[]> {
    const out: string[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(new QueryCommand({
        TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": "CELEBS" }, ExclusiveStartKey,
      }));
      out.push(...(r.Items ?? []).map((i) => i.userId as string));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** Which of these users do I follow? One BatchGet of my follow edges (no full following list). */
  async function followingAmong(me: string, userIds: string[]): Promise<Set<string>> {
    const items = await batchGetAll(doc, table, [...new Set(userIds)].map((id) => followsKey(me, id)));
    return new Set(items.map((i) => i.userId as string));
  }

  return { follow, unfollow, isFollowing, listFollowing, listFollowers, registerCelebIfNeeded, isCeleb, listCelebs, followingAmong };
}
