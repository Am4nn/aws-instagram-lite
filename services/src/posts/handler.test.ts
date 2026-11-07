import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { makeHandler, type PostsDeps } from "./handler.js";
import type { Post } from "./repo.js";
import { mediaUrl } from "./keys.js";
import { json } from "../lib/http.js";

function deps(over: Partial<PostsDeps> = {}): PostsDeps & { posts: Map<string, Post> } {
  const posts = new Map<string, Post>();
  return {
    posts,
    hasProfile: async (id) => id !== "noprofile",
    repo: {
      async createPending(userId, input) {
        const p: Post = { postId: `p${posts.size + 1}`, userId, ...input, status: "PENDING", createdAt: "t", likeCount: 0, commentCount: 0 };
        posts.set(p.postId, p);
        return p;
      },
      async get(id) { return posts.get(id) ?? null; },
      async listByUser(userId) { return [...posts.values()].filter((p) => p.userId === userId && p.status === "READY"); },
    },
    presignPut: async (key, type, size) => `https://s3/put/${key}?type=${type}&size=${size}`,
    likedBy: async (ids, me) => new Set(me === "fan" ? ids : []),
    ...over,
  };
}

const ev = (routeKey: string, o: { sub?: string; body?: unknown; params?: Record<string, string> } = {}) =>
  ({
    routeKey,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    pathParameters: o.params,
    requestContext: { authorizer: { jwt: { claims: { sub: o.sub ?? "u1" }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

const call = async (h: ReturnType<typeof makeHandler>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = await h(e);
  return { status: r.statusCode, body: JSON.parse(r.body as string) };
};

describe("media URLs", () => {
  it("are same-site paths served by CloudFront /media/* (no presigned GETs)", () => {
    expect(mediaUrl("media/p1/thumb.jpg")).toBe("/media/p1/thumb.jpg");
  });
  it("API responses carry no CORS header (only the Next.js server calls the API)", () => {
    expect(json(200, {}).headers).not.toHaveProperty("access-control-allow-origin");
  });
});

describe("posts handler", () => {
  it("POST /posts creates a PENDING post and returns a presigned PUT for the caller's own key", async () => {
    const r = await call(makeHandler(deps()), ev("POST /posts", { body: { caption: "hi", contentType: "image/png", size: 123 } }));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ postId: "p1", key: "uploads/u1/p1", uploadUrl: "https://s3/put/uploads/u1/p1?type=image/png&size=123" });
  });

  it("POST /posts → 400 on bad input, 404 before the user has a profile", async () => {
    expect((await call(makeHandler(deps()), ev("POST /posts", { body: { contentType: "image/gif" } }))).status).toBe(400);
    expect((await call(makeHandler(deps()), ev("POST /posts", { sub: "noprofile", body: { contentType: "image/png", size: 1 } }))).status).toBe(404);
  });

  it("GET /posts/{id} adds media URLs only when READY", async () => {
    const d = deps();
    const h = makeHandler(d);
    await call(h, ev("POST /posts", { body: { contentType: "image/png", size: 1 } }));
    const pending = await call(h, ev("GET /posts/{id}", { params: { id: "p1" } }));
    expect(pending.body).toMatchObject({ status: "PENDING" });
    expect(pending.body.thumbUrl).toBeUndefined();
    d.posts.set("p1", { ...d.posts.get("p1")!, status: "READY", media: { thumb: "media/p1/thumb.jpg", full: "media/p1/full.jpg", width: 1, height: 1 } });
    const ready = await call(h, ev("GET /posts/{id}", { params: { id: "p1" } }));
    expect(ready.body).toMatchObject({ thumbUrl: "/media/p1/thumb.jpg", fullUrl: "/media/p1/full.jpg", likedByMe: false });
    expect((await call(h, ev("GET /posts/{id}", { sub: "fan", params: { id: "p1" } }))).body.likedByMe).toBe(true);
  });

  it("GET /posts/{id} → 404 for unknown posts and for other users' unfinished posts", async () => {
    const h = makeHandler(deps());
    expect((await call(h, ev("GET /posts/{id}", { params: { id: "nope" } }))).status).toBe(404);
    await call(h, ev("POST /posts", { sub: "u1", body: { contentType: "image/png", size: 1 } }));
    expect((await call(h, ev("GET /posts/{id}", { sub: "u2", params: { id: "p1" } }))).status).toBe(404);
  });

  it("GET /users/{userId}/posts lists READY posts with thumb URLs", async () => {
    const d = deps();
    d.posts.set("p9", { postId: "p9", userId: "u7", caption: "", contentType: "image/png", status: "READY", createdAt: "t",
      likeCount: 0, commentCount: 0, media: { thumb: "media/p9/thumb.jpg", full: "media/p9/full.jpg", width: 1, height: 1 } });
    const r = await call(makeHandler(d), ev("GET /users/{userId}/posts", { params: { userId: "u7" } }));
    expect(r.body).toEqual({ items: [expect.objectContaining({ postId: "p9", thumbUrl: "/media/p9/thumb.jpg" })] });
  });
});
