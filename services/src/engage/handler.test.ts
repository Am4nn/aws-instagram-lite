import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { makeHandler } from "./handler.js";
import type { Post } from "../posts/repo.js";

function setup() {
  const post = (status: Post["status"], likeCount = 0): Post =>
    ({ postId: "p1", userId: "alice", caption: "", contentType: "image/png", status, createdAt: "t", likeCount, commentCount: 0 });
  const posts: Record<string, Post> = { p1: post("READY"), pend: { ...post("PENDING"), postId: "pend" } };
  const likes = new Set<string>();
  const comments: { text: string; username: string }[] = [];
  const h = makeHandler({
    getPost: async (id) => posts[id] ?? null,
    getUsername: async (id) => (id === "noprofile" ? null : `${id}_name`),
    repo: {
      async like(p, u) { const k = `${p.postId}:${u}`; if (likes.has(k)) return false; likes.add(k); posts[p.postId].likeCount++; return true; },
      async unlike(id, u) { const had = likes.delete(`${id}:${u}`); if (had) posts[id].likeCount--; return had; },
      async addComment(p, user, text) { comments.push({ text, username: user.username }); return { commentId: "c1", postId: p.postId, ...user, text, createdAt: "t" }; },
      async listComments() { return { items: comments as never[] }; },
    },
  });
  return { h, comments };
}

const ev = (routeKey: string, id: string, o: { sub?: string; body?: unknown } = {}) =>
  ({
    routeKey, pathParameters: { id }, body: o.body === undefined ? undefined : JSON.stringify(o.body),
    requestContext: { authorizer: { jwt: { claims: { sub: o.sub ?? "carol" }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
const call = async (h: ReturnType<typeof makeHandler>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = await h(e);
  return { status: r.statusCode, body: JSON.parse(r.body as string) };
};

describe("engage handler", () => {
  it("like/unlike return liked + the fresh count, idempotently", async () => {
    const { h } = setup();
    expect((await call(h, ev("POST /posts/{id}/like", "p1"))).body).toEqual({ liked: true, likeCount: 1 });
    expect((await call(h, ev("POST /posts/{id}/like", "p1"))).body).toEqual({ liked: true, likeCount: 1 });
    expect((await call(h, ev("DELETE /posts/{id}/like", "p1"))).body).toEqual({ liked: false, likeCount: 0 });
  });

  it("404 for unknown or not-yet-READY posts", async () => {
    const { h } = setup();
    expect((await call(h, ev("POST /posts/{id}/like", "nope"))).status).toBe(404);
    expect((await call(h, ev("POST /posts/{id}/comments", "pend", { body: { text: "hi" } }))).status).toBe(404);
  });

  it("comments: 201 with the commenter's username; text must be 1-500 chars; needs a profile", async () => {
    const { h, comments } = setup();
    const r = await call(h, ev("POST /posts/{id}/comments", "p1", { body: { text: "  nice  " } }));
    expect(r.status).toBe(201);
    expect(comments).toEqual([{ text: "nice", username: "carol_name" }]);
    expect((await call(h, ev("POST /posts/{id}/comments", "p1", { body: { text: "   " } }))).status).toBe(400);
    expect((await call(h, ev("POST /posts/{id}/comments", "p1", { body: { text: "x".repeat(501) } }))).status).toBe(400);
    expect((await call(h, ev("POST /posts/{id}/comments", "p1", { sub: "noprofile", body: { text: "hi" } }))).status).toBe(404);
    expect((await call(h, ev("GET /posts/{id}/comments", "p1"))).body.items).toHaveLength(1);
  });
});
