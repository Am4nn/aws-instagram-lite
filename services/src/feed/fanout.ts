import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { BatchWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makePostsRepo } from "../posts/repo.js";
import { makeFollowsRepo } from "../social/repo.js";

export type FeedItem = { ownerId: string; postId: string; authorId: string; createdAt: string };
type PostRef = { postId: string; userId: string; createdAt: string };

export const feedKey = (ownerId: string, createdAt: string, postId: string) =>
  ({ pk: `FEED#${ownerId}`, sk: `${createdAt}#${postId}` });
const FEED_TTL_SECONDS = 30 * 24 * 3600;
const BACKFILL = 10;

type Deps = {
  threshold: number;
  getFollowerCount: (userId: string) => Promise<number | null>;
  getPost: (postId: string) => Promise<PostRef | null>;
  followers: (userId: string) => AsyncIterable<string[]>;
  recentPosts: (userId: string, limit: number) => Promise<PostRef[]>;
  writeFeed: (items: FeedItem[]) => Promise<void>;
};

/**
 * Hybrid fan-out (see docs/learn/system-design-notes.md §1):
 *  - normal author posts → push a pointer into every follower's feed (fan-out on write)
 *  - celeb posts → nothing to push; readers pull celeb posts at read time (fan-out on read)
 * Writes are idempotent (same key = overwrite), so redelivered events are harmless.
 */
export function makeFanout(d: Deps) {
  const isCeleb = async (userId: string) => ((await d.getFollowerCount(userId)) ?? 0) >= d.threshold;
  const item = (ownerId: string, p: PostRef): FeedItem =>
    ({ ownerId, postId: p.postId, authorId: p.userId, createdAt: p.createdAt });

  async function postPublished({ postId }: { postId: string }) {
    const post = await d.getPost(postId);
    if (!post) return;
    await d.writeFeed([item(post.userId, post)]); // you see your own posts
    if (await isCeleb(post.userId)) return;
    for await (const page of d.followers(post.userId)) await d.writeFeed(page.map((f) => item(f, post)));
  }

  async function userFollowed({ followerId, followeeId }: { followerId: string; followeeId: string }) {
    if (await isCeleb(followeeId)) return; // their posts are pulled at read time anyway
    const posts = await d.recentPosts(followeeId, BACKFILL);
    if (posts.length) await d.writeFeed(posts.map((p) => item(followerId, p)));
  }

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        const e = JSON.parse(record.body); // EventBridge event delivered via SQS
        if (e["detail-type"] === "PostPublished") await postPublished(e.detail);
        else if (e["detail-type"] === "UserFollowed") await userFollowed(e.detail);
      } catch (err) {
        console.error("fanout failed", record.messageId, err);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

/** BatchWrite takes 25 items per call and may hand some back ("unprocessed") under load. */
export async function batchPutFeed(doc: DynamoDBDocumentClient, table: string, items: FeedItem[]) {
  const ttl = Math.floor(Date.now() / 1000) + FEED_TTL_SECONDS;
  for (let i = 0; i < items.length; i += 25) {
    let requests: Record<string, unknown>[] | undefined = items.slice(i, i + 25).map((f) => ({
      PutRequest: { Item: { ...feedKey(f.ownerId, f.createdAt, f.postId), type: "feed", postId: f.postId, authorId: f.authorId, ttl } },
    }));
    for (let attempt = 0; requests?.length && attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const r = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: requests as never } }));
      requests = r.UnprocessedItems?.[table] as Record<string, unknown>[] | undefined;
    }
    if (requests?.length) throw new Error(`${requests.length} feed writes still unprocessed`);
  }
}

let real: ReturnType<typeof makeFanout> | undefined;
export const handler = (event: SQSEvent) => {
  real ??= (() => {
    const doc = docClient();
    const table = tableName();
    const users = makeUsersRepo(doc, table);
    const posts = makePostsRepo(doc, table);
    const follows = makeFollowsRepo(doc, table);
    return makeFanout({
      threshold: Number(process.env.CELEB_THRESHOLD ?? 10000),
      getFollowerCount: async (id) => (await users.getProfile(id))?.followerCount ?? null,
      getPost: async (id) => {
        const p = await posts.get(id);
        return p && p.status === "READY" ? p : null;
      },
      followers: (id) => follows.listFollowers(id),
      recentPosts: (id, limit) => posts.listByUser(id, limit),
      writeFeed: (items) => batchPutFeed(doc, table, items),
    });
  })();
  return real(event);
};
