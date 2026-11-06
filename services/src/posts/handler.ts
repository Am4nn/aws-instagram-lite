import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json } from "../lib/http.js";
import { subFromEvent, parseBody } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makePostsRepo, type Post, type PostsRepo } from "./repo.js";
import { uploadKey } from "./keys.js";
import { validateCreatePost } from "./validate.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export type PostsDeps = {
  repo: Pick<PostsRepo, "createPending" | "get" | "listByUser">;
  hasProfile: (userId: string) => Promise<boolean>;
  presignPut: (key: string, contentType: string) => Promise<string>;
  presignGet: (key: string) => Promise<string>;
};

/** Adds short-lived image URLs (media bucket is private). */
async function withUrls(post: Post, presignGet: PostsDeps["presignGet"]) {
  if (post.status !== "READY" || !post.media) return post;
  return { ...post, thumbUrl: await presignGet(post.media.thumb), fullUrl: await presignGet(post.media.full) };
}

export function makeHandler(d: PostsDeps) {
  return async (event: Event) => {
    const me = subFromEvent(event);
    switch (event.routeKey) {
      case "POST /posts": {
        const body = parseBody(event);
        if (body === null) return json(400, { error: "invalid JSON" });
        const input = validateCreatePost(body);
        if (!input.ok) return json(400, { error: input.error });
        if (!(await d.hasProfile(me))) return json(404, { error: "choose a username first" });
        const post = await d.repo.createPending(me, input.value);
        const key = uploadKey(me, post.postId);
        return json(201, { postId: post.postId, key, uploadUrl: await d.presignPut(key, input.value.contentType) });
      }
      case "GET /posts/{id}": {
        const post = await d.repo.get(event.pathParameters?.id ?? "");
        // Only the author may see a post that isn't READY yet.
        if (!post || (post.status !== "READY" && post.userId !== me)) return json(404, { error: "post not found" });
        return json(200, await withUrls(post, d.presignGet));
      }
      case "GET /users/{userId}/posts": {
        const items = await d.repo.listByUser(event.pathParameters?.userId ?? "");
        return json(200, { items: await Promise.all(items.map((p) => withUrls(p, d.presignGet))) });
      }
      default:
        return json(404, { error: `no route ${event.routeKey}` });
    }
  };
}

let real: ReturnType<typeof makeHandler> | undefined;

function realDeps(): PostsDeps {
  const s3 = new S3Client({ forcePathStyle: true });
  const users = makeUsersRepo(docClient(), tableName());
  return {
    repo: makePostsRepo(docClient(), tableName()),
    hasProfile: async (id) => (await users.getProfile(id)) !== null,
    presignPut: (key, contentType) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.UPLOADS_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 }),
    presignGet: (key) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: key }), { expiresIn: 3600 }),
  };
}

export const handler = (event: Event) => (real ??= makeHandler(realDeps()))(event);
