import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { makeHandler, type FeedDeps } from "./handler.js";
import { signCursor } from "./cursor.js";
import type { Ref } from "./merge.js";

const KEY = "secret-key";
const ref = (postId: string, authorId: string, day: number): Ref =>
  ({ postId, authorId, sortKey: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z#${postId}` });

function deps(): FeedDeps & { calls: string[] } {
  const calls: string[] = [];
  const feed = [ref("a2", "alice", 4), ref("a1", "alice", 2)];
  const celeb = [ref("s1", "star", 3), ref("s0", "star", 1)];
  const before = (rs: Ref[], b?: string) => rs.filter((r) => !b || r.sortKey < b);
  return {
    calls,
    threshold: 3,
    cursorKey: async () => KEY,
    listFollowing: async () => ["alice", "star"],
    followerCounts: async (ids) => new Map(ids.map((id) => [id, id === "star" ? 5 : 1])),
    feedPage: async (_me, b, n) => { calls.push(`feed<${b ?? ""}`); return before(feed, b).slice(0, n); },
    celebPosts: async (id, b, n) => { calls.push(`celeb:${id}`); return before(celeb, b).slice(0, n); },
    hydrate: async (refs) => refs.map((r) => ({ postId: r.postId, author: { userId: r.authorId, username: r.authorId } })),
  };
}

const ev = (cursor?: string) =>
  ({
    routeKey: "GET /feed",
    queryStringParameters: cursor ? { cursor } : undefined,
    requestContext: { authorizer: { jwt: { claims: { sub: "bob" }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

const call = async (h: ReturnType<typeof makeHandler>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = await h(e);
  return { status: r.statusCode, body: JSON.parse(r.body as string) };
};

describe("feed handler", () => {
  it("merges pushed + pulled (celeb only) posts newest first, hydrated", async () => {
    const d = deps();
    const r = await call(makeHandler({ ...d, pageSize: 10 }), ev());
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { postId: string }) => i.postId)).toEqual(["a2", "s1", "a1", "s0"]);
    expect(d.calls).toContain("celeb:star");
    expect(d.calls).not.toContain("celeb:alice");
    expect(r.body.next).toBeUndefined();
  });

  it("returns a signed next cursor and the next page continues after it", async () => {
    const h = makeHandler({ ...deps(), pageSize: 2 });
    const p1 = await call(h, ev());
    expect(p1.body.items.map((i: { postId: string }) => i.postId)).toEqual(["a2", "s1"]);
    const p2 = await call(h, ev(p1.body.next));
    expect(p2.body.items.map((i: { postId: string }) => i.postId)).toEqual(["a1", "s0"]);
  });

  it("rejects a tampered cursor with 400", async () => {
    const forged = signCursor("2026-12-31", "not-the-key");
    expect((await call(makeHandler(deps()), ev(forged))).status).toBe(400);
  });
});
