import { randomUUID } from "node:crypto";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { profileKey } from "../users/repo.js";
import type { CreatePostInput } from "./validate.js";

export type PostStatus = "PENDING" | "READY" | "FAILED";
export type Media = { thumb: string; full: string; width: number; height: number };
export type Post = {
  postId: string;
  userId: string;
  caption: string;
  contentType: string;
  status: PostStatus;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  media?: Media;
  failReason?: string;
};

export const postKey = (postId: string) => ({ pk: `POST#${postId}`, sk: "POST" });
const PENDING_TTL_SECONDS = 24 * 3600; // abandoned uploads disappear after a day

const toPost = (i: Record<string, unknown>): Post => ({
  postId: i.postId as string,
  userId: i.userId as string,
  caption: (i.caption as string) ?? "",
  contentType: i.contentType as string,
  status: i.status as PostStatus,
  createdAt: i.createdAt as string,
  likeCount: (i.likeCount as number) ?? 0,
  commentCount: (i.commentCount as number) ?? 0,
  ...(i.media ? { media: i.media as Media } : {}),
  ...(i.failReason ? { failReason: i.failReason as string } : {}),
});

const isConditionFailure = (e: unknown) =>
  ["ConditionalCheckFailedException", "TransactionCanceledException"].includes((e as Error).name);

export type PostsRepo = ReturnType<typeof makePostsRepo>;

export function makePostsRepo(doc: DynamoDBDocumentClient, table: string) {
  async function createPending(userId: string, input: Pick<CreatePostInput, "caption" | "contentType">): Promise<Post> {
    const postId = randomUUID();
    const item = {
      ...postKey(postId), type: "post", postId, userId, caption: input.caption, contentType: input.contentType,
      status: "PENDING", createdAt: new Date().toISOString(), likeCount: 0, commentCount: 0,
      ttl: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS,
    };
    await doc.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: "attribute_not_exists(pk)" }));
    return toPost(item);
  }

  async function get(postId: string): Promise<Post | null> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: postKey(postId), ConsistentRead: true }));
    return Item ? toPost(Item) : null;
  }

  /** READY posts only: PENDING/FAILED posts have no gsi1 keys (a "sparse index"). Newest first. */
  async function listByUser(userId: string, limit = 30): Promise<Post[]> {
    const { Items = [] } = await doc.send(new QueryCommand({
      TableName: table, IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": "POST#" },
      ScanIndexForward: false, Limit: limit,
    }));
    return Items.map(toPost);
  }

  /**
   * PENDING → READY + postCount+1, in one transaction. The `status = PENDING` condition makes it
   * idempotent: a retried step or redelivered message returns false and changes nothing.
   */
  async function markReady(postId: string, media: Media): Promise<boolean> {
    const post = await get(postId);
    if (!post) return false;
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: table, Key: postKey(postId),
          ConditionExpression: "#s = :pending",
          UpdateExpression: "SET #s = :ready, media = :media, gsi1pk = :gpk, gsi1sk = :gsk REMOVE #ttl",
          ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
          ExpressionAttributeValues: {
            ":pending": "PENDING", ":ready": "READY", ":media": media,
            ":gpk": `USER#${post.userId}`, ":gsk": `POST#${post.createdAt}#${postId}`,
          },
        } },
        { Update: {
          TableName: table, Key: profileKey(post.userId),
          ConditionExpression: "attribute_exists(pk)",
          UpdateExpression: "ADD postCount :one", ExpressionAttributeValues: { ":one": 1 },
        } },
      ] }));
      return true;
    } catch (e) {
      // A cancelled transaction means EITHER our condition failed (already READY: fine) OR it
      // collided with another write to the same profile (transient: must retry). Re-read to tell.
      if (isConditionFailure(e) && (await get(postId))?.status !== "PENDING") return false;
      throw e;
    }
  }

  async function markFailed(postId: string, reason: string): Promise<boolean> {
    try {
      await doc.send(new UpdateCommand({
        TableName: table, Key: postKey(postId),
        ConditionExpression: "#s = :pending",
        UpdateExpression: "SET #s = :failed, failReason = :r",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":pending": "PENDING", ":failed": "FAILED", ":r": reason.slice(0, 500) },
      }));
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  return { createPending, get, listByUser, markReady, markFailed };
}
