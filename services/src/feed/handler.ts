import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { BatchGetCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json } from "../lib/http.js";
import { subFromEvent } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { profileKey } from "../users/repo.js";
import { postKey } from "../posts/repo.js";
import { makeFollowsRepo } from "../social/repo.js";
import { makeEngageRepo } from "../engage/repo.js";
import { signCursor, verifyCursor } from "./cursor.js";
import { mergeFeed, type Ref } from "./merge.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export type FeedDeps = {
  threshold: number;
  pageSize?: number;
  cursorKey: () => Promise<string>;
  listFollowing: (me: string) => Promise<string[]>;
  followerCounts: (userIds: string[]) => Promise<Map<string, number>>;
  feedPage: (me: string, before: string | undefined, limit: number) => Promise<Ref[]>;
  celebPosts: (userId: string, before: string | undefined, limit: number) => Promise<Ref[]>;
  hydrate: (refs: Ref[], viewerId: string) => Promise<unknown[]>;
};

export function makeHandler(d: FeedDeps) {
  const pageSize = d.pageSize ?? 10;
  return async (event: Event) => {
    const me = subFromEvent(event);
    const key = await d.cursorKey();
    const token = event.queryStringParameters?.cursor;
    const before = token ? verifyCursor(token, key) : undefined;
    if (before === null) return json(400, { error: "invalid cursor" });

    const following = await d.listFollowing(me);
    const counts = await d.followerCounts(following);
    const celebs = following.filter((id) => (counts.get(id) ?? 0) >= d.threshold);
    // Over-fetch: unfollowed authors get filtered out after reading.
    const [feedItems, ...celebLists] = await Promise.all([
      d.feedPage(me, before, pageSize * 3),
      ...celebs.map((id) => d.celebPosts(id, before, pageSize)),
    ]);
    const page = mergeFeed({ feedItems, celebPosts: celebLists.flat(), following: new Set(following), me, limit: pageSize });
    return json(200, {
      items: await d.hydrate(page.items, me),
      ...(page.next ? { next: signCursor(page.next, key) } : {}),
    });
  };
}

// ---------- real dependencies ----------

async function batchGet(doc: DynamoDBDocumentClient, table: string, keys: Record<string, string>[]) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let req: Record<string, unknown>[] | undefined = keys.slice(i, i + 100);
    for (let attempt = 0; req?.length && attempt < 5; attempt++) {
      const r = await doc.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: req } } }));
      out.push(...(r.Responses?.[table] ?? []));
      req = r.UnprocessedKeys?.[table]?.Keys as Record<string, unknown>[] | undefined;
    }
  }
  return out;
}

function realDeps(): FeedDeps {
  const doc = docClient();
  const table = tableName();
  const follows = makeFollowsRepo(doc, table);
  const sm = new SecretsManagerClient({});
  const s3 = new S3Client({ forcePathStyle: true });
  let secret: Promise<string> | undefined; // fetched once per Lambda container
  const presign = (Key: string) =>
    getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key }), { expiresIn: 3600 });

  return {
    threshold: Number(process.env.CELEB_THRESHOLD ?? 10000),
    cursorKey: () => (secret ??= sm.send(new GetSecretValueCommand({ SecretId: process.env.CURSOR_SECRET_ARN }))
      .then((r) => r.SecretString!)
      .catch((e) => { secret = undefined; throw e; })), // don't cache a failure for the container's lifetime
    listFollowing: (me) => follows.listFollowing(me),
    followerCounts: async (ids) => {
      const items = await batchGet(doc, table, ids.map(profileKey));
      return new Map(items.map((p) => [p.userId as string, (p.followerCount as number) ?? 0]));
    },
    feedPage: async (me, before, limit) => {
      const r = await doc.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: before ? "pk = :pk AND sk < :b" : "pk = :pk",
        ExpressionAttributeValues: { ":pk": `FEED#${me}`, ...(before ? { ":b": before } : {}) },
        ScanIndexForward: false, Limit: limit,
      }));
      return (r.Items ?? []).map((i) => ({ postId: i.postId, authorId: i.authorId, sortKey: i.sk }));
    },
    celebPosts: async (userId, before, limit) => {
      const r = await doc.send(new QueryCommand({
        TableName: table, IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND gsi1sk BETWEEN :lo AND :hi",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":lo": "POST#", ":hi": before ? `POST#${before}` : "POST#~" },
        ScanIndexForward: false, Limit: limit,
      }));
      return (r.Items ?? [])
        .map((i) => ({ postId: i.postId, authorId: i.userId, sortKey: `${i.createdAt}#${i.postId}` }))
        .filter((ref) => !before || ref.sortKey < before);
    },
    hydrate: async (refs, viewerId) => {
      const liked = await makeEngageRepo(doc, table).likedBy(refs.map((r) => r.postId), viewerId);
      const posts = await batchGet(doc, table, refs.map((r) => postKey(r.postId)));
      const authors = await batchGet(doc, table, [...new Set(refs.map((r) => r.authorId))].map(profileKey));
      const byPost = new Map(posts.map((p) => [p.postId as string, p]));
      const byUser = new Map(authors.map((a) => [a.userId as string, a]));
      const out = [];
      for (const r of refs) { // keep merge order; skip posts deleted since
        const p = byPost.get(r.postId) as Record<string, any> | undefined;
        if (!p || p.status !== "READY") continue;
        const a = byUser.get(r.authorId);
        out.push({
          postId: p.postId, userId: p.userId, caption: p.caption, createdAt: p.createdAt,
          likeCount: p.likeCount ?? 0, commentCount: p.commentCount ?? 0, likedByMe: liked.has(r.postId),
          author: { userId: r.authorId, username: (a?.username as string) ?? "unknown" },
          thumbUrl: await presign(p.media.thumb), fullUrl: await presign(p.media.full),
        });
      }
      return out;
    },
  };
}

let real: ReturnType<typeof makeHandler> | undefined;
export const handler = (event: Event) => (real ??= makeHandler(realDeps()))(event);
