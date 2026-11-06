import { describe, it, expect } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { makeFanout, type FeedItem } from "./fanout.js";

const msg = (detailType: string, detail: unknown, id = "m0") =>
  ({ messageId: id, body: JSON.stringify({ "detail-type": detailType, source: "x", detail }) });
const batch = (...records: ReturnType<typeof msg>[]) => ({ Records: records }) as unknown as SQSEvent;

function setup(followerCounts: Record<string, number>, followersOf: Record<string, string[]>) {
  const written: FeedItem[] = [];
  const posts: Record<string, { postId: string; userId: string; createdAt: string }> = {
    p1: { postId: "p1", userId: "alice", createdAt: "2026-01-01T00:00:00Z" },
    s1: { postId: "s1", userId: "star", createdAt: "2026-01-02T00:00:00Z" },
  };
  const fanout = makeFanout({
    threshold: 3,
    getFollowerCount: async (id) => followerCounts[id] ?? null,
    getPost: async (id) => posts[id] ?? null,
    async *followers(id) { const all = followersOf[id] ?? []; for (let i = 0; i < all.length; i += 2) yield all.slice(i, i + 2); },
    recentPosts: async (id) => Object.values(posts).filter((p) => p.userId === id),
    writeFeed: async (items) => { written.push(...items); },
  });
  return { fanout, written };
}

const owners = (items: FeedItem[]) => items.map((i) => i.ownerId).sort();

describe("fanout", () => {
  it("PostPublished by a normal author → feed item for every follower + the author", async () => {
    const { fanout, written } = setup({ alice: 3 - 1 }, { alice: ["bob", "carol"] });
    expect(await fanout(batch(msg("PostPublished", { postId: "p1", userId: "alice" })))).toEqual({ batchItemFailures: [] });
    expect(owners(written)).toEqual(["alice", "bob", "carol"]);
    expect(written[0]).toMatchObject({ postId: "p1", authorId: "alice", createdAt: "2026-01-01T00:00:00Z" });
  });

  it("PostPublished by a celeb → only the author's own feed (followers pull at read time)", async () => {
    const { fanout, written } = setup({ star: 3 }, { star: ["a", "b", "c"] });
    await fanout(batch(msg("PostPublished", { postId: "s1", userId: "star" })));
    expect(owners(written)).toEqual(["star"]);
  });

  it("UserFollowed → backfills the followee's recent posts into the follower's feed (not for celebs)", async () => {
    const normal = setup({ alice: 0 }, {});
    await normal.fanout(batch(msg("UserFollowed", { followerId: "bob", followeeId: "alice" })));
    expect(normal.written).toEqual([{ ownerId: "bob", postId: "p1", authorId: "alice", createdAt: "2026-01-01T00:00:00Z" }]);
    const celeb = setup({ star: 5 }, {});
    await celeb.fanout(batch(msg("UserFollowed", { followerId: "bob", followeeId: "star" })));
    expect(celeb.written).toEqual([]);
  });

  it("ignores unknown events and missing posts; reports failing messages only", async () => {
    const { fanout, written } = setup({}, {});
    const r = await fanout(batch(
      msg("Other", {}, "m0"),
      msg("PostPublished", { postId: "nope", userId: "x" }, "m1"),
      { messageId: "m2", body: "{not json" } as ReturnType<typeof msg>,
    ));
    expect(written).toEqual([]);
    expect(r).toEqual({ batchItemFailures: [{ itemIdentifier: "m2" }] });
  });
});
